// The install that bunx spawns takes where packages come from, and what checks
// them, from the bunfig.toml and .npmrc of the project that bunx runs in.
// https://github.com/oven-sh/bun/issues/5361
describe("the project's registries", () => {
  const packageJson = (name: string, more: object = {}) => JSON.stringify({ name, version: "1.0.0", ...more });
  const bunAdd = [bunExe(), "add"];

  /**
   * A registry for each name. Each one has `px-probe` and `@probe/px-probe`, and
   * their bin prints the name: the output says which registry served the package.
   */
  async function registries<Name extends string>(...names: Name[]) {
    const servers = await Promise.all(
      names.map(name =>
        localRegistry(
          ...["px-probe", "@probe/px-probe"].map(pkg => fixturePackage(pkg, "1.0.0", "px-probe", echoBin(name))),
        ),
      ),
    );
    return {
      /** The URL of the registry `name`, as a config file names it. */
      url: (name: Name) => `${servers[names.indexOf(name)].url}/`,
      /** The registries that got a request since the last call, each with the credentials it got. */
      take() {
        const used: { [name in Name]?: (string | null)[] } = {};
        for (const [i, { requests, authorization }] of servers.entries()) {
          if (requests.length > 0) used[names[i]] = [...new Set(authorization)];
          requests.length = 0;
          authorization.length = 0;
        }
        return used;
      },
      [Symbol.dispose]() {
        for (const server of servers) server[Symbol.dispose]();
      },
    };
  }

  /** `~/.npmrc` names the registry `user`: the weakest way to name one, so that a file of the project can name another. */
  const world = (user: string, project: DirectoryTree, home: DirectoryTree = {}) =>
    sandbox(undefined, { cwd: project, home: { ".npmrc": `registry=${user}\n`, ...home } });

  /** Every file below `dir` with its bytes, to compare before and after a command. */
  function snapshot(dir: string) {
    const files: Record<string, string> = {};
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      const path = join(entry.parentPath, entry.name);
      files[path.slice(dir.length + 1).replaceAll("\\", "/")] = entry.isDirectory()
        ? "<dir>"
        : readFileSync(path, "latin1");
    }
    return files;
  }

  /** The names of the trees that bunx has for px-probe. Windows keeps them in the temp directory. */
  const trees = (box: ReturnType<typeof sandbox>) =>
    readdirSync(isWindows ? box.tmp : box.root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.includes("px-probe@"))
      .map(entry => entry.name.slice(entry.name.indexOf("px-probe@")))
      .sort();

  // `cwd` is where the command runs. `config` is where the case puts its files.
  // `applies` is whether that directory is the project of `cwd`.
  const layouts = {
    "the project root": {
      files: { "package.json": packageJson("proj") },
      cwd: ".",
      config: ".",
      applies: true,
    },
    "a subdirectory": {
      files: { "package.json": packageJson("proj"), src: { deep: { keep: "" } } },
      cwd: "src/deep",
      config: ".",
      applies: true,
    },
    "a workspace": {
      files: {
        "package.json": packageJson("root", { workspaces: ["packages/*"] }),
        packages: { app: { "package.json": packageJson("app") } },
      },
      cwd: "packages/app",
      config: ".",
      applies: true,
    },
    "a directory with no package.json": {
      files: { keep: "" },
      cwd: ".",
      config: ".",
      applies: true,
    },
    "a project below the config": {
      files: { proj: { "package.json": packageJson("proj") } },
      cwd: "proj",
      config: ".",
      applies: false,
    },
    "a package that is not a workspace of the project above it": {
      files: { "package.json": packageJson("proj"), examples: { demo: { "package.json": packageJson("demo") } } },
      cwd: "examples/demo",
      config: ".",
      applies: false,
    },
    "a subdirectory that holds the config": {
      files: { "package.json": packageJson("proj"), sub: { keep: "" } },
      cwd: "sub",
      config: "sub",
      applies: false,
    },
    "a workspace that holds the config": {
      files: {
        "package.json": packageJson("root", { workspaces: ["packages/*"] }),
        packages: { app: { "package.json": packageJson("app") } },
      },
      cwd: "packages/app",
      config: "packages/app",
      applies: false,
    },
  };

  // `url` is the registry that the project names.
  const inputs = {
    "a bunfig.toml registry": {
      pkg: "px-probe",
      authorization: null,
      files: (url: string) => ({ "bunfig.toml": `[install]\nregistry = "${url}"\n` }),
    },
    "a bunfig.toml scope": {
      pkg: "@probe/px-probe",
      authorization: null,
      files: (url: string) => ({ "bunfig.toml": `[install.scopes]\nprobe = { url = "${url}" }\n` }),
    },
    "an .npmrc registry": {
      pkg: "px-probe",
      authorization: null,
      files: (url: string) => ({ ".npmrc": `registry=${url}\n` }),
    },
    "an .npmrc scope with a token from .env": {
      pkg: "@probe/px-probe",
      authorization: "Bearer from-dotenv",
      files: (url: string) => ({
        ".npmrc": `@probe:registry=${url}\n${url.slice(url.indexOf("//"))}:_authToken=\${PROBE_TOKEN}\n`,
        ".env": "PROBE_TOKEN=from-dotenv\n",
      }),
    },
    "a bunfig.toml scope with a token from .env.local": {
      pkg: "@probe/px-probe",
      authorization: "Bearer from-dotenv-local",
      files: (url: string) => ({
        "bunfig.toml": `[install.scopes]\nprobe = { url = "${url}", token = "$PROBE_TOKEN" }\n`,
        ".env.local": "PROBE_TOKEN=from-dotenv-local\n",
      }),
    },
  };

  describe.each(Object.entries(layouts))("from %s", (_, layout) => {
    it.concurrent.each(Object.entries(inputs))("uses the same registry as bun add for %s", async (_, input) => {
      using registry = await registries("USER", "PROJECT");
      const expected = layout.applies ? { PROJECT: [input.authorization] } : { USER: [null] };
      const project = () => {
        const box = world(registry.url("USER"), layout.files);
        for (const [name, contents] of Object.entries(input.files(registry.url("PROJECT")))) {
          writeFileSync(join(box.cwd, layout.config, name), contents);
        }
        return box;
      };

      using forAdd = project();
      const add = await forAdd.run([input.pkg], { bunx: bunAdd, cwd: join(forAdd.cwd, layout.cwd) });
      const addUsed = registry.take();

      using forBunx = project();
      const before = snapshot(forBunx.cwd);
      const bunx = await forBunx.run([input.pkg], { cwd: join(forBunx.cwd, layout.cwd) });

      expect({ add: addUsed, bunx: registry.take(), stdout: bunx.stdout, project: snapshot(forBunx.cwd) }).toEqual({
        add: expected,
        bunx: expected,
        stdout: layout.applies ? "PROJECT\n" : "USER\n",
        project: before,
      });
      expect({ add: add.exitCode, bunx: bunx.exitCode }).toEqual({ add: 0, bunx: 0 });
    });
  });

  // `bun add` takes the nearest package.json, whatever it has. bunx takes the project, as it does
  // to find the project's own copy of a tool.
  it.concurrent("a package.json that only sets the module type belongs to the project above it", async () => {
    using registry = await registries("USER", "PROJECT");
    using box = world(registry.url("USER"), {
      "package.json": packageJson("proj"),
      "bunfig.toml": `[install]\nregistry = "${registry.url("PROJECT")}"\n`,
      app: { "package.json": JSON.stringify({ type: "module" }) },
    });

    expect(await box.run(["px-probe"], { cwd: join(box.cwd, "app") })).toMatchObject({
      stdout: "PROJECT\n",
      exitCode: 0,
    });
    expect(registry.take()).toEqual({ PROJECT: [null] });
  });

  it.concurrent("applies to a package with a version", async () => {
    using registry = await registries("USER", "PROJECT");
    using box = world(registry.url("USER"), {
      "package.json": packageJson("proj"),
      ".npmrc": `registry=${registry.url("PROJECT")}\n`,
    });

    expect(await box.run(["px-probe@1.0.0"])).toMatchObject({ stdout: "PROJECT\n", exitCode: 0 });
    expect(registry.take()).toEqual({ PROJECT: [null] });
  });

  it.concurrent("reads a scope from the project when the environment names the default registry", async () => {
    using registry = await registries("USER", "ENV", "PROJECT", "SCOPE");
    const project = () =>
      world(registry.url("USER"), {
        "package.json": packageJson("proj"),
        "bunfig.toml":
          `[install]\nregistry = "${registry.url("PROJECT")}"\n` +
          `[install.scopes]\nprobe = { url = "${registry.url("SCOPE")}" }\n`,
      });
    const env = (box: ReturnType<typeof sandbox>) => ({ ...box.env, npm_config_registry: registry.url("ENV") });

    using forAdd = project();
    await forAdd.run(["px-probe"], { bunx: bunAdd, env: env(forAdd) });
    const addUsed = registry.take();

    using forBunx = project();
    const unscoped = await forBunx.run(["px-probe"], { env: env(forBunx) });
    const unscopedUsed = registry.take();
    const scoped = await forBunx.run(["@probe/px-probe"], { env: env(forBunx) });

    expect({ unscoped: unscopedUsed, scoped: registry.take(), stdout: scoped.stdout }).toEqual({
      unscoped: addUsed,
      scoped: { SCOPE: [null] },
      stdout: "SCOPE\n",
    });
    expect({ unscoped: unscoped.exitCode, scoped: scoped.exitCode }).toEqual({ unscoped: 0, scoped: 0 });
  });

  // The project's .env files only expand `$VAR` in its bunfig.toml and .npmrc.
  it.concurrent("does not take a registry from the project's .env", async () => {
    using registry = await registries("USER", "DOTENV");
    using box = world(registry.url("USER"), {
      "package.json": packageJson("proj"),
      ".env": `BUN_CONFIG_REGISTRY=${registry.url("DOTENV")}\n`,
    });

    expect(await box.run(["px-probe"])).toMatchObject({ stdout: "USER\n", exitCode: 0 });
    expect(registry.take()).toEqual({ USER: [null] });
  });

  // The other settings are about the project's own node_modules. A tool that bunx installs for
  // this project is laid out, cached and locked like a tool for any other.
  it.concurrent("takes no other setting of the project's [install]", async () => {
    using registry = await registries("USER", "PROJECT");
    using box = world(registry.url("USER"), {
      "package.json": packageJson("proj"),
      "bunfig.toml":
        `[install]\nregistry = "${registry.url("PROJECT")}"\ndryRun = true\nfrozenLockfile = true\n` +
        `linker = "isolated"\noptional = false\ncache = "of-the-project"\n`,
      ".npmrc": "ignore-scripts=true\ndry-run=true\n",
    });
    const before = snapshot(box.cwd);

    expect(await box.run(["px-probe"])).toMatchObject({ stdout: "PROJECT\n", exitCode: 0 });
    const tree = join(isWindows ? box.tmp : box.root, readdirSync(isWindows ? box.tmp : box.root).find(name => name.includes("px-probe@latest+"))!);
    expect({
      project: snapshot(box.cwd),
      // Hoisted: the isolated linker keeps packages in node_modules/.bun.
      layout: readdirSync(join(tree, "node_modules")).sort(),
    }).toEqual({ project: before, layout: [".bin", "px-probe"] });
  });

  // A package's install script, and the node-gyp that `bun install` runs for one, are not the
  // project's own commands.
  it.concurrent("a bunx that runs in node_modules uses the user's registry", async () => {
    using registry = await registries("USER", "PROJECT");
    using box = world(registry.url("USER"), {
      "package.json": packageJson("proj"),
      "bunfig.toml": `[install]\nregistry = "${registry.url("PROJECT")}"\n`,
      node_modules: { dep: { "package.json": packageJson("dep") } },
    });

    expect(await box.run(["px-probe"], { cwd: join(box.cwd, "node_modules", "dep") })).toMatchObject({
      stdout: "USER\n",
      exitCode: 0,
    });
    expect({ used: registry.take(), trees: trees(box) }).toEqual({ used: { USER: [null] }, trees: ["px-probe@latest"] });
  });

  it.concurrent.each([
    ["cannot be parsed", "[install\nregistry = \n"],
    ["cannot be read", null],
  ])("stops when the project's bunfig.toml %s", async (_, contents) => {
    using registry = await registries("USER", "PROJECT");
    using box = world(registry.url("USER"), {
      "package.json": packageJson("proj"),
      "bunfig.toml": contents ?? `[install]\nregistry = "${registry.url("PROJECT")}"\n`,
      src: { keep: "" },
    });
    using unprivileged = unprivilegedSpawnOptions(box.dir);
    if (contents === null) chmodSync(join(box.cwd, "bunfig.toml"), 0o000);

    const bunx = await box.run(["px-probe"], { cwd: join(box.cwd, "src"), ...unprivileged });

    expect(bunx.stderr).toContain(join(box.cwd, "bunfig.toml"));
    expect({ stdout: bunx.stdout, used: registry.take(), exitCode: bunx.exitCode }).toEqual({
      stdout: "",
      used: {},
      exitCode: 1,
    });
  });

  // What decides the content of a tree is part of its name: the registries that the project
  // names, not the files that name them.
  it.concurrent("projects share a tree when their registries are the same", async () => {
    using registry = await registries("USER", "A", "B", "C");
    const bunfig = (name: "A" | "B" | "C") => `[install]\nregistry = "${registry.url(name)}"\n`;
    using box = world(registry.url("USER"), {
      plain: { keep: "" },
      a: {
        "package.json": packageJson("a"),
        "bunfig.toml": bunfig("A"),
        examples: { demo: { "package.json": packageJson("demo") } },
      },
      b: { "package.json": packageJson("b"), "bunfig.toml": bunfig("B"), src: { keep: "" } },
      "also-a": { "package.json": packageJson("also-a"), ".npmrc": `registry=${registry.url("USER")}\n`, "bunfig.toml": "# As a.\n" + bunfig("A") },
    });
    const run = async (cwd: string) => {
      const { stdout } = await box.run(["px-probe"], { cwd: join(box.cwd, cwd) });
      return [stdout, registry.take()];
    };

    const ran = [];
    for (const cwd of ["a/examples/demo", "plain", "a", "b/src", "also-a"]) ran.push(await run(cwd));
    const first = trees(box);
    writeFileSync(join(box.cwd, "a", "bunfig.toml"), bunfig("C"));
    ran.push(await run("a"));

    expect({ ran, plain: first.filter(name => name === "px-probe@latest").length, trees: first.length, afterEdit: trees(box).length }).toEqual({
      ran: [
        // `demo` is a project of its own, which names no registry.
        ["USER\n", { USER: [null] }],
        ["USER\n", {}],
        ["A\n", { A: [null] }],
        ["B\n", { B: [null] }],
        ["A\n", { A: [null] }],
        ["C\n", { C: [null] }],
      ],
      plain: 1,
      trees: 4,
      afterEdit: 5,
    });
  });

  // The scanner gates what bunx downloads and runs. It is found from the project,
  // and a scanner that cannot be found there stops the install.
  describe("with a security scanner", () => {
    const scanner = (advisories: string) =>
      `export const scanner = {\n` +
      `  version: "1",\n` +
      `  async scan({ packages }) {\n` +
      `    console.error("SCANNED " + packages.map(p => p.name).join(","));\n` +
      `    return ${advisories};\n` +
      `  },\n` +
      `};\n`;
    const fatal = `packages.map(p => ({ package: p.name, level: "fatal", description: "blocked by the test" }))`;
    const installed = (advisories = "[]") => ({
      node_modules: {
        "probe-scanner": {
          "package.json": packageJson("probe-scanner", { type: "module", main: "index.js" }),
          "index.js": scanner(advisories),
        },
      },
    });
    const named = `[install.security]\nscanner = "probe-scanner"\n`;

    const cases = {
      "the project names a scanner that is installed in it": {
        project: { "bunfig.toml": named, ...installed() },
        home: {},
        expected: { scanned: true, stdout: "USER\n", exitCode: 0 },
      },
      "the project names a scanner file by relative path": {
        project: { "bunfig.toml": `[install.security]\nscanner = "./scanner.js"\n`, "scanner.js": scanner("[]") },
        home: {},
        expected: { scanned: true, stdout: "USER\n", exitCode: 0 },
      },
      "the user config names a scanner that is installed in the project": {
        project: installed(),
        home: { ".bunfig.toml": named },
        expected: { scanned: true, stdout: "USER\n", exitCode: 0 },
      },
      // The report of the scanner is not the output of the tool.
      "the scanner reports a fatal advisory": {
        project: { "bunfig.toml": named, ...installed(fatal) },
        home: {},
        expected: { scanned: true, stdout: "", exitCode: 1 },
      },
      "the project names a scanner that is not installed": {
        project: { "bunfig.toml": named },
        home: {},
        expected: { scanned: false, stdout: "", exitCode: 1 },
      },
      "the user config names a scanner that is not installed": {
        project: {},
        home: { ".bunfig.toml": named },
        expected: { scanned: false, stdout: "", exitCode: 1 },
      },
    };

    it.concurrent.each(Object.entries(cases))("%s", async (_, { project, home, expected }) => {
      using registry = await registries("USER");
      using box = world(
        registry.url("USER"),
        { "package.json": packageJson("proj"), src: { keep: "" }, ...project },
        home,
      );

      const bunx = await box.run(["px-probe"], { cwd: join(box.cwd, "src") });

      expect({
        scanned: bunx.stderr.includes("SCANNED px-probe"),
        stdout: bunx.stdout,
        exitCode: bunx.exitCode,
      }).toEqual(expected);
    });
  });

  // The release-age gate covers the command that downloads and runs a package,
  // not only `bun add`.
  it.concurrent("applies the project's minimumReleaseAge to the package it would run", async () => {
    using registry = await localRegistry({ ...fixturePackage("px-probe", "1.0.0", "px-probe"), daysOld: 1 / 24 });
    using box = world(`${registry.url}/`, {
      "package.json": packageJson("proj"),
      "bunfig.toml": "[install]\nminimumReleaseAge = 86400\n",
      src: { keep: "" },
    });

    expect(await box.run(["px-probe"], { cwd: join(box.cwd, "src") })).toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("minimum-release-age"),
      exitCode: 1,
    });
  });
});
