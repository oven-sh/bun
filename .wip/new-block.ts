// bunx installs the package it runs with a spawned `bun add`, into a tree of
// its own. That install takes bunfig.toml, .npmrc and .env from the root that
// `bun add` picks for the directory bunx runs in.
// https://github.com/oven-sh/bun/issues/5361
describe("the project's install config", () => {
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

  // `cwd` is where the command runs. `config` is where the case puts its files.
  // `applies` is whether `bun add` run from `cwd` reads config in that directory.
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
    "a workspace member": {
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
    "a subdirectory that holds the config": {
      files: { "package.json": packageJson("proj"), sub: { keep: "" } },
      cwd: "sub",
      config: "sub",
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
      const add = await forAdd.run([input.pkg], { bunx: bunAdd, from: layout.cwd });
      const addUsed = registry.take();

      using forBunx = project();
      const before = snapshot(forBunx.cwd);
      const bunx = await forBunx.run([input.pkg], { from: layout.cwd });

      expect({ add: addUsed, bunx: registry.take(), stdout: bunx.stdout, project: snapshot(forBunx.cwd) }).toEqual({
        add: expected,
        bunx: expected,
        stdout: layout.applies ? "PROJECT\n" : "USER\n",
        project: before,
      });
      expect({ add: add.exitCode, bunx: bunx.exitCode }).toEqual({ add: 0, bunx: 0 });
    });
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

  it.concurrent("fails on a malformed project bunfig.toml, as bun add does", async () => {
    using registry = await registries("USER");
    const project = () =>
      world(registry.url("USER"), {
        "package.json": packageJson("proj"),
        "bunfig.toml": "[install\nregistry = \n",
        src: { keep: "" },
      });

    using forAdd = project();
    const add = await forAdd.run(["px-probe"], { bunx: bunAdd, from: "src" });

    using forBunx = project();
    const bunx = await forBunx.run(["px-probe"], { from: "src" });

    expect(bunx.stderr).toContain("failed to load bunfig");
    expect({ stdout: bunx.stdout, used: registry.take() }).toEqual({ stdout: "", used: {} });
    expect({ add: add.exitCode, bunx: bunx.exitCode }).toEqual({ add: 1, bunx: 1 });
  });

  // `bun add` skips a bunfig.toml that it finds but cannot read.
  it.skipIf(isWindows)("skips a project bunfig.toml that it cannot read", async () => {
    using registry = await registries("USER", "PROJECT", "UNREADABLE");
    using box = world(registry.url("USER"), {
      "package.json": packageJson("proj"),
      "bunfig.toml": `[install]\nregistry = "${registry.url("UNREADABLE")}"\n`,
      ".npmrc": `registry=${registry.url("PROJECT")}\n`,
    });
    using unprivileged = unprivilegedSpawnOptions(box.dir);
    chmodSync(join(box.cwd, "bunfig.toml"), 0o000);

    expect(await box.run(["px-probe"], unprivileged)).toMatchObject({ stdout: "PROJECT\n", exitCode: 0 });
    expect(registry.take()).toEqual({ PROJECT: [null] });
  });

  it.concurrent("does not read config files in the directory it installs into", async () => {
    using registry = await registries("USER", "PLANTED");
    using box = world(registry.url("USER"), { keep: "" });

    expect(await box.run(["px-probe"])).toMatchObject({ stdout: "USER\n", exitCode: 0 });
    const tree = box.tree("px-probe@latest");
    const planted = registry.url("PLANTED");
    writeFileSync(join(tree, "bunfig.toml"), `[install]\nregistry = "${planted}"\n`);
    writeFileSync(join(tree, ".npmrc"), `registry=${planted}\n`);
    writeFileSync(join(tree, ".env"), `BUN_CONFIG_REGISTRY=${planted}\n`);
    registry.take();

    // An explicit dist-tag asks the registry again.
    expect(await box.run(["px-probe@latest"])).toMatchObject({ stdout: "USER\n", exitCode: 0 });
    expect(registry.take()).toEqual({ USER: [null] });
  });

  // A project's bunfig.toml or .npmrc can name another registry, so a project
  // that has one gets its own tree, and a new one when the file changes.
  it.concurrent("keeps a tree for each project config file", async () => {
    using registry = await registries("USER", "A", "B", "C");
    const bunfig = (name: "A" | "B" | "C") => `[install]\nregistry = "${registry.url(name)}"\n`;
    using box = world(registry.url("USER"), {
      plain: { keep: "" },
      a: { "package.json": packageJson("a"), "bunfig.toml": bunfig("A") },
      b: { "package.json": packageJson("b"), "bunfig.toml": bunfig("B"), src: { keep: "" } },
    });
    /** The names of the trees that bunx has. Windows keeps them in the temp directory. */
    const trees = () =>
      readdirSync(isWindows ? box.tmp : box.root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.includes("px-probe@latest"))
        .map(entry => entry.name);

    const stdout: string[] = [];
    for (const from of ["plain", "a", "b/src"]) stdout.push((await box.run(["px-probe"], { from })).stdout);
    const first = trees();
    registry.take();

    stdout.push((await box.run(["px-probe"], { from: "a" })).stdout);
    const warm = registry.take();

    writeFileSync(join(box.cwd, "a", "bunfig.toml"), "# edited\n" + bunfig("C"));
    stdout.push((await box.run(["px-probe"], { from: "a" })).stdout);

    expect({
      stdout,
      // Without a project config file the tree has the plain name.
      plain: first.filter(name => name.endsWith("px-probe@latest")).length,
      trees: first.length,
      warm,
      afterEdit: trees().length,
    }).toEqual({
      stdout: ["USER\n", "A\n", "B\n", "A\n", "C\n"],
      plain: 1,
      trees: 3,
      warm: {},
      afterEdit: 4,
    });
  });

  // The scanner gates what bunx downloads and runs. It is found from the project
  // root. A scanner that cannot be found there stops the install.
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
        expected: { scanned: true, ran: true, exitCode: 0 },
      },
      "the project names a scanner file by relative path": {
        project: { "bunfig.toml": `[install.security]\nscanner = "./scanner.js"\n`, "scanner.js": scanner("[]") },
        home: {},
        expected: { scanned: true, ran: true, exitCode: 0 },
      },
      "the user config names a scanner that is installed in the project": {
        project: installed(),
        home: { ".bunfig.toml": named },
        expected: { scanned: true, ran: true, exitCode: 0 },
      },
      "the scanner reports a fatal advisory": {
        project: { "bunfig.toml": named, ...installed(fatal) },
        home: {},
        expected: { scanned: true, ran: false, exitCode: 1 },
      },
      "the project names a scanner that is not installed": {
        project: { "bunfig.toml": named },
        home: {},
        expected: { scanned: false, ran: false, exitCode: 1 },
      },
      "the user config names a scanner that is not installed": {
        project: {},
        home: { ".bunfig.toml": named },
        expected: { scanned: false, ran: false, exitCode: 1 },
      },
    };

    it.concurrent.each(Object.entries(cases))("%s", async (_, { project, home, expected }) => {
      using registry = await registries("USER");
      using box = world(
        registry.url("USER"),
        { "package.json": packageJson("proj"), src: { keep: "" }, ...project },
        home,
      );

      const bunx = await box.run(["px-probe"], { from: "src" });

      expect({
        scanned: bunx.stderr.includes("SCANNED px-probe"),
        ran: bunx.stdout.includes("USER"),
        exitCode: bunx.exitCode,
      }).toEqual(expected);
    });
  });

  // A new version changes the lockfile in the directory bunx installs into, so
  // a frozen lockfile cannot hold there.
  it.concurrent.each([
    ["frozenLockfile", "frozenLockfile = true"],
    ["production", "production = true"],
  ])("installs a new version after the user bunfig.toml sets %s", async (_, setting) => {
    using registry = await localRegistry(
      fixturePackage("px-probe", "1.0.0", "px-probe"),
      fixturePackage("px-probe", "2.0.0", "px-probe"),
    );
    registry.tagLatest("px-probe", "1.0.0");
    using box = world(`${registry.url}/`, { keep: "" });

    const first = await box.run(["px-probe"]);
    writeFileSync(join(box.home, ".bunfig.toml"), `[install]\n${setting}\n`);
    registry.tagLatest("px-probe", "2.0.0");
    // An explicit dist-tag asks the registry again.
    const second = await box.run(["px-probe@latest"]);

    expect({ first: first.stdout, second: second.stdout }).toEqual({
      first: "px-probe 1.0.0\n",
      second: "px-probe 2.0.0\n",
    });
    expect({ first: first.exitCode, second: second.exitCode }).toEqual({ first: 0, second: 0 });
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

    expect(await box.run(["px-probe"], { from: "src" })).toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("blocked by minimum-release-age: 86400 seconds"),
      exitCode: 1,
    });
  });
});
