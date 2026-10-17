import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

const library = (text: string) => `export interface Context {
  body: unknown;
  query: Record<string, string>;
  path: string;
}
export type Handler = (context: Context) => unknown;
export const handlers: Handler[] = [];
export function get(handler: Handler): void {
  handlers.push(handler);
}
export const compose = ${text} as (handler: Handler) => () => unknown;
`;
const fromConstructor = library(`new Function("handler", "return () => handler({ path: '/' })")`);
const application = `import { compose, get, handlers } from "./lib";\nget(({ path }) => path);\nconsole.log(compose(handlers[0]!)());\n`;
const another = `import { get } from "./lib";\nget(({ path }) => path);\n`;

async function run(files: Record<string, string>, entryPoint: string) {
  using dir = tempDir("aot-functions-made-from-text", { "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, allowJs: true } }), ...files });
  const directory = String(dir);
  const outfile = join(directory, "out" + (isWindows ? ".exe" : ""));
  await using build = Bun.spawn({ cmd: [bunExe(), "build", "--compile", "--aot", "--aot-explain=foreign", entryPoint, "--outfile", outfile], cwd: directory, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect({ exitCode, said: exitCode ? out + err : "" }).toEqual({ exitCode: 0, said: "" });
  await using compiled = Bun.spawn({ cmd: [outfile], cwd: directory, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, ended] = await Promise.all([compiled.stdout.text(), compiled.stderr.text(), compiled.exited]);
  return { stdout, stderr, exitCode: ended, explained: out + err };
}
const prints = (stdout: string) => expect.objectContaining({ stdout, stderr: "", exitCode: 0 });

test("a handler takes an object that lacks what its parameter's type declares where the program holds an unchecked or a JavaScript module", async () => {
  for (const [name, text] of [["more.ts", "// @ts-nocheck\n" + another], ["more.js", another]] as const) {
    const entry = `import "./app";\nimport "./${name}";\n`;
    expect(await run({ "lib.ts": fromConstructor, "app.ts": application, [name]: text, "entry.ts": entry }, "./entry.ts")).toEqual(prints("/\n"));
  }
}, 240_000);

test("so does a handler that is handed straight to a function made from text", async () => {
  expect(await run({ "lib.ts": fromConstructor, "app.ts": `import { compose } from "./lib";\nconsole.log(compose(({ path }) => path)());\n` }, "./app.ts")).toEqual(prints("/\n"));
}, 120_000);

test("eval makes such a function too", async () => {
  const fromEval = library(`(0, eval)("(handler) => () => handler({ path: '/' })")`);
  expect(await run({ "lib.ts": fromEval, "app.ts": `import { compose } from "./lib";\nconsole.log(compose(({ path }) => path)());\n` }, "./app.ts")).toEqual(prints("/\n"));
}, 120_000);

test("an object that has all that the type declares is taken as before", async () => {
  const complete = library(`new Function("handler", "return () => handler({ body: 1, query: {}, path: '/' })")`);
  expect(await run({ "lib.ts": complete, "app.ts": application }, "./app.ts")).toEqual(prints("/\n"));
}, 120_000);

test("a function of the program that is named Function is a function of the program", async () => {
  const app = `import type { Handler } from "./lib";
function Function(handler: Handler): () => unknown {
  return () => handler({ body: 1, query: {}, path: "/" });
}
console.log(Function(({ path }) => path)());
`;
  const ran = await run({ "lib.ts": library("((handler: Handler) => () => handler({ body: 1, query: {}, path: '/' }))"), "app.ts": app }, "./app.ts");
  expect(ran).toEqual(prints("/\n"));
  expect(ran.explained).not.toContain("aot: foreign: Context:");
}, 120_000);
