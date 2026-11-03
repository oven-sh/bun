import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": JSON.stringify({ name: "my-app", exports: { ".": "./src/api.ts", "./sub": "./src/sub.ts" } }),
  "src/api.ts": `export const api = { name: "api" };`,
  "src/sub.ts": `export const sub = { name: "sub" };`,
  "node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "./lib/main.js" }),
  "node_modules/dep/lib/main.js": `exports.dep = { name: "dep" };`,
  "node_modules/@scope/dep/package.json": JSON.stringify({ name: "@scope/dep", exports: { ".": "./main.js" } }),
  "node_modules/@scope/dep/main.js": `exports.scoped = { name: "scoped" };`,
  "src/main.ts": `import path from "node:path";
import { api } from "./api";
import { sub } from "./sub";
import { dep } from "dep";
import { scoped } from "@scope/dep";
(globalThis as any).seen = { api, sub, dep, scoped };
for (const file of process.argv.slice(2)) await import(path.resolve(file));
`,
};
const plugin = `const seen = globalThis.seen;
console.log((await import("my-app")).api === seen.api, (await import("my-app/sub")).sub === seen.sub);
console.log((await import("dep")).dep === seen.dep, (await import("@scope/dep")).scoped === seen.scoped);
try {
  await import("my-app/absent");
} catch (error) {
  console.log(error.code);
}
`;

test("a plug-in finds the program and its packages by name where the disk holds neither", async () => {
  using dir = tempDir("aot-names-of-packages", files);
  const project = String(dir);
  const name = process.platform === "win32" ? "app.exe" : "app";
  const flags = ["--compile", "--aot", "--aot-allow-code-from-disk"];
  const build = await run([bunExe(), "build", ...flags, "./src/main.ts", "--outfile", name], project, bunEnv);
  expect({ stderr: build.exitCode === 0 ? "" : build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });
  using other = tempDir("aot-names-of-packages-elsewhere", { "plugin.mjs": plugin });
  const installed = join(String(other), name);
  cpSync(join(project, name), installed);
  rmSync(project, { recursive: true });
  const result = await run([installed, join(String(other), "plugin.mjs")], String(other), bunEnv);
  expect({
    stdout: result.stdout,
    stderr: result.exitCode === 0 ? "" : result.stderr,
    exitCode: result.exitCode,
  }).toEqual({
    stdout: "true true\ntrue true\nERR_MODULE_NOT_FOUND\n",
    stderr: "",
    exitCode: 0,
  });
}, 60_000);
