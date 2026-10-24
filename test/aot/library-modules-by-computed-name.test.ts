// The executable holds a module of Bun's own only if code names it. A specifier that is computed names none, so it brings none
// into the build, and at run time it finds the ones that are there for another reason.
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
  const refused = { stdout: "require MODULE_NOT_FOUND\nimport ERR_MODULE_NOT_FOUND\n", errors: [], exitCode: 0 };
  expect(await run([computed.executable, "node:path"], directory)).toEqual(found);
  expect(await run([computed.executable, "node:zlib"], directory)).toEqual(refused);
  expect(await run([every.executable, "node:zlib"], directory)).toEqual(found);
});

test("the example of docs/bundler/aot-compatibility.mdx: require(name) adds no built-in module, and an import by name keeps one", async () => {
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
