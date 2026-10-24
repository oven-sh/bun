// The executable holds a module of Bun's own only if code names it. A specifier that is computed names none, so it brings none
// into the build. At run time it finds the ones that are there for another reason, compiled, and every other one too: Bun interprets that one.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(240_000);

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

// The module is found, and with BUN_JSC_crashIfInterpreterIsUsed=1 the run ends at it: it is not compiled.
async function isFoundAndInterpreted(cmd: string[], cwd: string, module: string, found: { stdout: string }) {
  const { stdout, exitCode } = await runCommand(cmd, cwd, bunEnv);
  expect({ stdout, exitCode }).toEqual({ stdout: found.stdout, exitCode: 0 });
  const stopped = await runCommand(cmd, cwd, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  expect(stopped.stderr).toMatch(new RegExp("^crashIfInterpreterIsUsed: \\S+ " + module + " ", "m"));
}

async function build(directory: string, entry: string) {
  const executable = join(directory, entry.replace(".js", isWindows ? ".exe" : ""));
  const report = join(directory, entry + ".report.json");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--aot-report=" + report, entry, "--outfile", executable],
    directory,
  );
  expect({ errors: built.errors, exitCode: built.exitCode }).toEqual({ errors: [], exitCode: 0 });
  const { statistics } = await Bun.file(report).json();
  return { executable, filesOfBun: statistics.SourceFilesRuntime as number };
}

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
  expect(await run([computed.executable, "node:path"], directory)).toEqual(found);
  await isFoundAndInterpreted([computed.executable, "node:zlib"], directory, "node:zlib", found);
  expect(await run([every.executable, "node:zlib"], directory)).toEqual(found);
});

test("the example of docs/bundler/aot-compatibility.mdx: require(name) adds no built-in module, and an import by name compiles one", async () => {
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
  await isFoundAndInterpreted([executable, "node:dgram"], directory, "node:dgram", found);
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
  await isFoundAndInterpreted([prefixed.executable, "zlib"], directory, "node:zlib", {
    stdout: "require object\nimport object\n",
  });
});
