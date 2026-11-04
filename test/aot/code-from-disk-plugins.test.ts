// An executable built with --aot-allow-code-from-disk loads files that the build never saw. What such a file asks for by a path
// or by a name is the compiled module where the executable holds it, and is found on disk as `bun run` finds it where it doesn't.
//
// A build with that flag holds all of Bun's library, so the cases share one program and one build.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
// One by one, in this order: the first three run in the folder of the project, the third deletes its sources, the last two delete all of it.
import { testOneByOne as test } from "./supported";

const manifest = (name: string, fields: object) => JSON.stringify({ name, version: "1.0.0", ...fields });
const namesOnDisk = [
  "by-index",
  "by-main",
  "by-exports",
  "by-exports/sub",
  "by-module",
  "@scope/by-main",
  "by-type",
  "by-imports",
  "by-main/package.json",
  "by-main/lib/main",
];

// The root directory of the build is src, one folder below the working directory. shared lies beside it.
const program = {
  "package.json": JSON.stringify({ name: "my-app", exports: { ".": "./src/api.ts", "./sub": "./src/sub.ts" } }),
  "src/main.ts": `import path from "node:path";
import * as counter from "./counter.ts";
import { twice } from "./pairs.ts";
import { label } from "../shared/label.ts";
import installed from "some-package";
import { api } from "./api";
import { sub } from "./sub";
import { dep } from "dep";
import { scoped } from "@scope/dep";
twice();
(globalThis as any).bumpOfProgram = counter.bump;
(globalThis as any).packageOfProgram = installed;
(globalThis as any).seen = { api, sub, dep, scoped };
for (const file of process.argv.slice(2)) await import(path.resolve(file));
console.log(label, "sees", counter.count, (await import(path.resolve("src/counter.ts"))) === counter);
setTimeout(() => console.log("the timer of the program ran"), 1);
`,
  "src/api.ts": `export const api = { name: "api" };`,
  "src/sub.ts": `export const sub = { name: "sub" };`,
  "src/counter.ts": `export let count = 0;
export function bump(): number {
  return ++count;
}
`,
  "src/pairs.ts": `import { bump } from "./counter.ts";
export function twice(): number {
  bump();
  return bump();
}
`,
  "shared/label.ts": `export const label = "the program";\n`,
  "node_modules/some-package/package.json": `{ "name": "some-package", "version": "1.0.0", "main": "./index.js" }\n`,
  "node_modules/some-package/index.js": `module.exports = { name: "some-package" };\n`,
  "node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "./lib/main.js" }),
  "node_modules/dep/lib/main.js": `exports.dep = { name: "dep" };`,
  "node_modules/@scope/dep/package.json": JSON.stringify({ name: "@scope/dep", exports: { ".": "./main.js" } }),
  "node_modules/@scope/dep/main.js": `exports.scoped = { name: "scoped" };`,
};
const onDiskAlone = {
  "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true, "paths": { "@lib/*": ["./lib/*"] } } }`,
  "lib/x.ts": `export const how: string = "tsconfig paths";`,
  "node_modules/by-index/package.json": manifest("by-index", {}),
  "node_modules/by-index/index.js": `exports.how = "index.js";`,
  "node_modules/by-main/package.json": manifest("by-main", { main: "./lib/main.js" }),
  "node_modules/by-main/lib/main.js": `exports.how = "main";`,
  "node_modules/by-exports/package.json": manifest("by-exports", {
    exports: { ".": { import: "./lib/i.mjs", require: "./lib/r.cjs" }, "./sub": "./lib/sub.js" },
  }),
  "node_modules/by-exports/lib/i.mjs": `export const how = "exports import";`,
  "node_modules/by-exports/lib/r.cjs": `exports.how = "exports require";`,
  "node_modules/by-exports/lib/sub.js": `exports.how = "exports sub";`,
  "node_modules/by-module/package.json": manifest("by-module", { main: "./lib/main.js", module: "./lib/esm.mjs" }),
  "node_modules/by-module/lib/main.js": `exports.how = "main beside module";`,
  "node_modules/by-module/lib/esm.mjs": `export const how = "module";`,
  "node_modules/@scope/by-main/package.json": manifest("@scope/by-main", { main: "./lib/main.js" }),
  "node_modules/@scope/by-main/lib/main.js": `exports.how = "scoped main";`,
  "node_modules/by-type/package.json": manifest("by-type", { type: "module", main: "./lib/main.js" }),
  "node_modules/by-type/lib/main.js": `export const how = "type module";`,
  "node_modules/by-imports/package.json": manifest("by-imports", {
    main: "./lib/main.js",
    imports: { "#inner": "./lib/inner.js" },
  }),
  "node_modules/by-imports/lib/main.js": `exports.how = require("#inner");`,
  "node_modules/by-imports/lib/inner.js": `module.exports = "imports map";`,
  "scripts/use.cjs": `for (const name of ${JSON.stringify(namesOnDisk)}) {
  const it = require(name);
  console.log("require", name, it.how ?? it.name);
}
`,
  "scripts/use.mjs": `for (const name of ${JSON.stringify(namesOnDisk)}) {
  const it = await import(name);
  console.log("import", name, it.how ?? it.default.how ?? it.default.name);
}
`,
  "scripts/static.ts": `import { how as main } from "by-main";
import { how as exported } from "by-exports";
import { how as scoped } from "@scope/by-main";
import { how as alias } from "@lib/x";
console.log("static", main, "|", exported, "|", scoped, "|", alias);
function mark(_: unknown, __: string, descriptor: PropertyDescriptor) {
  console.log("decorator of tsconfig", typeof descriptor.value);
}
class Marked {
  @mark method() {}
}
new Marked().method();
`,
  "scripts/timers.cjs": `const { mock } = require("node:test");
try {
  mock.timers.enable({ apis: ["setTimeout"] });
  let hits = 0;
  setTimeout(() => hits++, 1000);
  mock.timers.tick(1000);
  mock.timers.reset();
  console.log("timers: mocked, hits " + hits);
} catch (error) {
  console.log("timers: THREW " + error.message.split(" because ")[0]);
}
`,
  "scripts/trace.cjs": `try {
  const tracing = require("node:trace_events").createTracing({ categories: ["node.perf"] });
  tracing.enable();
  tracing.disable();
  console.log("trace: enabled and disabled");
} catch (error) {
  console.log("trace: THREW " + error.message.split(" because ")[0]);
}
`,
  "scripts/one.ts": `import { bump, count } from "../src/counter.ts";
console.log("one sees", count, bump === (globalThis as any).bumpOfProgram);
bump();
`,
  "scripts/three.mjs": `import installed, { name } from "some-package";
import * as label from "../shared/label.ts";
console.log("three sees", installed === globalThis.packageOfProgram, name, Object.keys(label).join());
`,
  "scripts/two.cjs": `const counter = require("../src/counter");
const { twice } = require("../src/pairs.ts");
console.log("two sees", counter.count, twice(), require("../shared/label.ts").label, require("some-package") === globalThis.packageOfProgram);
`,
};
const asksByPath = `import { bump, count } from "../src/counter.ts";
bump();
console.log("the plug-in sees", count, bump === globalThis.bumpOfProgram);
`;
const asksByName = `const seen = globalThis.seen;
console.log((await import("my-app")).api === seen.api, (await import("my-app/sub")).sub === seen.sub);
console.log((await import("dep")).dep === seen.dep, (await import("@scope/dep")).scoped === seen.scoped);
try {
  await import("my-app/absent");
} catch (error) {
  console.log(error.code);
}
`;

const dir = tempDir("aot-code-from-disk-plugins", { ...program, ...onDiskAlone });
const dirOfPath = tempDir("aot-code-from-disk-elsewhere", { "plugins/plugin.mjs": asksByPath, "somewhere/.keep": "" });
const dirOfName = tempDir("aot-code-from-disk-elsewhere", { "plugin.mjs": asksByName });
afterAll(() => {
  for (const each of [dir, dirOfPath, dirOfName]) each[Symbol.dispose]();
});
const project = String(dir);
const name = process.platform === "win32" ? "app.exe" : "app";
const executable = join(project, "dist", name);

let built: Promise<void> | undefined;
const build = () =>
  (built ??= (async () => {
    const flags = ["--compile", "--aot", "--aot-allow-code-from-disk"];
    const { stderr, exitCode } = await run(
      [bunExe(), "build", ...flags, "./src/main.ts", "--outfile", join("dist", name)],
      project,
      bunEnv,
    );
    expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  })());

let moved: Promise<void> | undefined;
/** The executable lies in dist of the two other folders, and the project is gone. */
const install = () =>
  (moved ??= build().then(() => {
    for (const other of [dirOfPath, dirOfName]) {
      mkdirSync(join(String(other), "dist"));
      cpSync(executable, join(String(other), "dist", name));
    }
    rmSync(project, { recursive: true });
  }));
const shown = ({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof run>>) => ({
  stdout,
  stderr: exitCode === 0 ? "" : stderr,
  exitCode,
});

test("a file on disk finds packages and path aliases on disk as under bun run", async () => {
  const scripts = ["scripts/use.cjs", "scripts/use.mjs", "scripts/static.ts"];
  const plain = await run([bunExe(), "src/main.ts", ...scripts], project, bunEnv);
  expect(plain.stdout).toContain("require by-exports exports require\n");
  expect(plain.stdout).toContain("static main | exports import | scoped main | tsconfig paths\n");
  expect(plain.stdout).toContain("decorator of tsconfig function\n");
  expect(plain.exitCode).toBe(0);
  await build();
  const compiled = await run([executable, ...scripts], project, bunEnv);
  expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
    stdout: plain.stdout,
    stderr: plain.stderr,
    exitCode: 0,
  });
}, 150_000);

// docs/compiler/compatibility.mdx, "Dynamic imports". The compiled files call the timers that the build saw, so a module that the build didn't see may not replace them.
test("a library module that only a file on disk loads changes no built-in", async () => {
  const scripts = ["scripts/timers.cjs", "scripts/trace.cjs"];
  const rest = "the program sees 2 true\nthe timer of the program ran\n";
  expect((await run([bunExe(), "src/main.ts", ...scripts], project, bunEnv)).stdout).toBe(
    "timers: mocked, hits 1\ntrace: enabled and disabled\n" + rest,
  );
  await build();
  expect(shown(await run([executable, ...scripts], project, bunEnv))).toEqual({
    stdout: "timers: THREW Cannot assign to setTimeout\ntrace: THREW Cannot assign to setTimeout\n" + rest,
    stderr: "",
    exitCode: 0,
  });
});

test("a file on disk gets the compiled module for a source file of the executable", async () => {
  const scripts = ["scripts/one.ts", "scripts/two.cjs", "scripts/three.mjs"];
  const plain = await run([bunExe(), "src/main.ts", ...scripts], project, bunEnv);
  expect(plain.stdout).toBe(
    "one sees 2 true\ntwo sees 3 5 the program true\nthree sees true some-package label\nthe program sees 5 true\nthe timer of the program ran\n",
  );
  await build();
  expect(await run([executable, ...scripts], project, bunEnv)).toEqual(plain);
  // Nothing is read from the sources.
  rmSync(join(project, "src"), { recursive: true });
  rmSync(join(project, "shared"), { recursive: true });
  expect(await run([executable, ...scripts], project, bunEnv)).toEqual(plain);
});

test("a plug-in finds the compiled module where the program is installed elsewhere", async () => {
  await install();
  const installed = String(dirOfPath);
  expect(readFileSync(join(installed, "dist", name)).includes(project)).toBe(false);
  const result = await run(
    [join(installed, "dist", name), join(installed, "plugins/plugin.mjs")],
    join(installed, "somewhere"),
    bunEnv,
  );
  expect(shown(result)).toEqual({
    stdout: "the plug-in sees 3 true\nthe program sees 3 true\nthe timer of the program ran\n",
    stderr: "",
    exitCode: 0,
  });
}, 60_000);

test("a plug-in finds the program and its packages by name where the disk holds neither", async () => {
  await install();
  const installed = String(dirOfName);
  const result = await run([join(installed, "dist", name), join(installed, "plugin.mjs")], installed, bunEnv);
  expect(shown(result)).toEqual({
    stdout: "true true\ntrue true\nERR_MODULE_NOT_FOUND\nthe program sees 2 true\nthe timer of the program ran\n",
    stderr: "",
    exitCode: 0,
  });
}, 60_000);
