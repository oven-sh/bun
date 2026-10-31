// The executable holds a module of Bun's own only if code names it. A specifier that is computed names none, so it brings none
// into the build, and at run time it finds the ones that are there for another reason.
import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { describe, test } from "./with-compiler";

async function runCommand(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const loads = `const name = process.argv[2];
try {
  console.log("require", typeof require(name));
} catch (error) {
  console.log("require", error.code);
}
await import(name).then(
  loaded => console.log("import", typeof loaded),
  error => console.log("import", error.code),
);
`;

async function run(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  return { stdout, errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode };
}

async function build(directory: string, entry: string) {
  const executable = join(directory, entry.replace(".js", isWindows ? ".exe" : ""));
  const report = join(directory, entry + ".report.json");
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-report=" + report,
      "--aot-report-detail=functions",
      entry,
      "--outfile",
      executable,
    ],
    directory,
  );
  expect({ errors: built.errors, exitCode: built.exitCode }).toEqual({ errors: [], exitCode: 0 });
  const { statistics, functions } = await Bun.file(report).json();
  const compiled = (functions as { file: string | null }[]).map(compiled => compiled.file ?? "");
  const modulesOfBun = [...new Set(compiled.filter(file => /^(node:|bun:|internal:)/.test(file)))].sort();
  return { executable, filesOfBun: statistics.SourceFilesRuntime as number, modulesOfBun };
}

describe.concurrent("modules of Bun's own by a computed name", () => {
  test("a computed specifier brings no module of Bun's own into the build and finds the ones that code names", async () => {
    using dir = tempDir("aot-modules-by-name", {
      "named.js": `import "node:path";\nconsole.log(process.argv[2]);\n`,
      "computed.js": `import "node:path";\n${loads}`,
      "every.js": `import "node:path";\nimport "node:zlib";\n${loads}`,
    });
    const directory = String(dir);
    const named = await build(directory, "named.js");
    const computed = await build(directory, "computed.js");
    const every = await build(directory, "every.js");
    expect(computed.filesOfBun).toBe(named.filesOfBun);

    const found = { stdout: "require object\nimport object\n", errors: [], exitCode: 0 };
    const refused = { stdout: "require MODULE_NOT_FOUND\nimport ERR_MODULE_NOT_FOUND\n", errors: [], exitCode: 0 };
    expect(await run([computed.executable, "node:path"], directory)).toEqual(found);
    expect(await run([computed.executable, "node:zlib"], directory)).toEqual(refused);
    expect(await run([every.executable, "node:zlib"], directory)).toEqual(found);
  });

  test("a computed specifier compiles no module of Bun's own that only a built-in in code that never runs would load", async () => {
    const neverCalled = `function tell(message) {\n  process.send(message);\n}\n`;
    using dir = tempDir("aot-modules-of-built-ins", {
      "alone.js": `import "node:path";\n${loads}`,
      "beside.js": `import "node:path";\n${neverCalled}${loads}`,
      "called.js": `import "node:path";\n${neverCalled}if (process.argv.length > 3) tell(process.argv[3]);\n${loads}`,
    });
    const directory = String(dir);
    const alone = await build(directory, "alone.js");
    const beside = await build(directory, "beside.js");
    const called = await build(directory, "called.js");
    expect(alone.modulesOfBun).not.toContain("node:net");
    expect(beside.modulesOfBun).toEqual(alone.modulesOfBun);
    expect(called.modulesOfBun).toContain("node:net");

    const found = { stdout: "require object\nimport object\n", errors: [], exitCode: 0 };
    const refused = { stdout: "require MODULE_NOT_FOUND\nimport ERR_MODULE_NOT_FOUND\n", errors: [], exitCode: 0 };
    expect(await run([beside.executable, "node:path"], directory)).toEqual(found);
    expect(await run([beside.executable, "node:net"], directory)).toEqual(refused);
    expect(await run([called.executable, "node:net"], directory)).toEqual(found);
  });

  test("the example of docs/compiler/compatibility.mdx: require(name) adds no built-in module, and an import by name keeps one", async () => {
    const load = `const name = process.argv[2] ?? "node:path";\nconsole.log(Object.keys(require(name)).length > 0);\n`;
    using dir = tempDir("aot-load-by-name", {
      "load.js": `import "node:path";\n\n${load}`,
      "kept.js": `import "node:path";\nimport "node:dgram";\n\n${load}`,
    });
    const directory = String(dir);
    const { executable } = await build(directory, "load.js");
    const kept = await build(directory, "kept.js");
    const found = { stdout: "true\n", errors: [], exitCode: 0 };
    expect(await run([executable, "node:path"], directory)).toEqual(found);
    const refused = await run([executable, "node:dgram"], directory);
    expect({ stdout: refused.stdout, exitCode: refused.exitCode }).toEqual({ stdout: "", exitCode: 1 });
    expect(refused.errors[0]).toStartWith(
      "error: Cannot load 'node:dgram': it isn't in this executable. Import it by name somewhere in your program to keep it.",
    );
    expect(await run([kept.executable, "node:dgram"], directory)).toEqual(found);
  });

  test("the name of a module of Bun's own that is written as a text brings none into a build that loads nothing by a computed name", async () => {
    using dir = tempDir("aot-written-names", {
      "show.js": `export function show(text) { console.log(text); }\n`,
      "locales/en.js": `export default "en";\n`,
      "plain.js": `import { show } from "./show.js";\nshow(process.argv[2]);\nshow("text");\nshow((await import("./locales/" + process.argv[2] + ".js")).default);\n`,
      "written.js": `import { show } from "./show.js";\nshow(process.argv[2]);\nshow("node:dgram");\nshow((await import("./locales/" + process.argv[2] + ".js")).default);\n`,
    });
    const directory = String(dir);
    const plain = await build(directory, "plain.js");
    const written = await build(directory, "written.js");
    expect(written.filesOfBun).toBe(plain.filesOfBun);
    expect(await run([written.executable, "en"], directory)).toEqual({
      stdout: "en\nnode:dgram\nen\n",
      errors: [],
      exitCode: 0,
    });
  });

  test("a name with a constant start brings no module of Bun's own into the build either", async () => {
    const loadsWithPrefix = `const name = process.argv[2];
try {
  console.log("require", typeof require("node:" + name));
} catch (error) {
  console.log("require", error.code);
}
await import(\`node:\${name}\`).then(
  loaded => console.log("import", typeof loaded),
  error => console.log("import", error.code),
);
`;
    using dir = tempDir("aot-modules-by-prefix", {
      "named.js": `import "node:path";\nconsole.log(process.argv[2]);\n`,
      "prefixed.js": `import "node:path";\n${loadsWithPrefix}`,
    });
    const directory = String(dir);
    const named = await build(directory, "named.js");
    const prefixed = await build(directory, "prefixed.js");
    expect(prefixed.filesOfBun).toBe(named.filesOfBun);
    expect(await run([prefixed.executable, "path"], directory)).toEqual({
      stdout: "require object\nimport object\n",
      errors: [],
      exitCode: 0,
    });
    expect(await run([prefixed.executable, "zlib"], directory)).toEqual({
      stdout: "require MODULE_NOT_FOUND\nimport ERR_MODULE_NOT_FOUND\n",
      errors: [],
      exitCode: 0,
    });
  });

  const modulesBehindAFlag = [
    "bun:internal-for-testing",
    "internal/test/binding",
    "internal/cluster/round_robin_handle",
    "internal/repl",
    "internal/repl/await",
    "internal/repl/history",
    "internal/util/inspect",
  ];

  // A debug build of Bun has these modules without the flag.
  test.skipIf(isDebug)(
    "a computed name of a module that only a flag of Bun turns on fails as under bun run",
    async () => {
      const asks = `const describe = error =>
  [error.constructor.name, error.name, error.message, error.code, error.level, Reflect.ownKeys(error).join()].join(" | ");
for (const name of process.argv.slice(2)) {
  try {
    console.log(name, "require", typeof require(name));
  } catch (error) {
    console.log(name, "require", describe(error));
  }
  await import(name).then(
    loaded => console.log(name, "import", typeof loaded),
    error => console.log(name, "import", describe(error)),
  );
}
`;
      using dir = tempDir("aot-modules-behind-a-flag", { "asks.js": asks });
      const directory = String(dir);
      const { executable } = await build(directory, "asks.js");
      const names = modulesBehindAFlag;
      const { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: _, ...withoutTheFlag } = bunEnv;
      const underBunRun = await runCommand([bunExe(), "asks.js", ...names], directory, withoutTheFlag);
      expect(underBunRun.stdout).toContain(
        `bun:internal-for-testing import BuildMessage | BuildMessage | ENOENT reading`,
      );
      const compiled = await runCommand([executable, ...names], directory, withoutTheFlag);
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
        stdout: underBunRun.stdout,
        exitCode: underBunRun.exitCode,
      });
    },
  );

  test.skipIf(isDebug)(
    "a constant name of a module that only a flag of Bun turns on is not found, whether or not the run has the flag",
    async () => {
      const names = modulesBehindAFlag;
      const asksFor = (name: string) => `try {
  console.log("${name}", "require", typeof require("${name}"));
} catch (error) {
  console.log("${name}", "require", describe(error));
}
await import("${name}").then(
  loaded => console.log("${name}", "import", typeof loaded),
  error => console.log("${name}", "import", describe(error)),
);
`;
      const asks = `const describe = error => [error.name, error.code, error.message.replace(/ from '[^']*'$/, "")].join(" | ");
${names.map(asksFor).join("")}`;
      using dir = tempDir("aot-constant-names-of-modules-behind-a-flag", { "asks.js": asks });
      const directory = String(dir);
      const executable = join(directory, isWindows ? "asks.exe" : "asks");
      // The environment of the build decides: with the flag it takes the program for one of Bun's own tests and compiles the modules in.
      const { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: _, ...withoutTheFlag } = bunEnv;
      const command = [bunExe(), "build", "--compile", "--aot", "asks.js", "--outfile", executable];
      const built = await runCommand(command, directory, withoutTheFlag);
      expect(built.exitCode).toBe(0);
      const notFound = names
        .flatMap(name => [
          `${name} require Error | MODULE_NOT_FOUND | Cannot find module '${name}'\n`,
          `${name} import Error | ERR_MODULE_NOT_FOUND | Cannot find module '${name}'\n`,
        ])
        .join("");
      for (const env of [withoutTheFlag, { ...withoutTheFlag, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" }]) {
        const compiled = await runCommand([executable], directory, env);
        expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: notFound, exitCode: 0 });
      }
    },
  );
});
