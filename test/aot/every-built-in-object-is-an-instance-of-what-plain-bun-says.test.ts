import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./harness/declare";

const questions = [
  "PATH instanceof Object",
  "PATH instanceof Function",
  "Object.prototype.isPrototypeOf(PATH)",
  "Function.prototype.isPrototypeOf(PATH)",
  "Object.getPrototypeOf(PATH) === Object.prototype",
  "Object.getPrototypeOf(PATH) === Function.prototype",
];

const listPaths = `
const isName = name => typeof name === "string" && /^[A-Za-z_$][\\w$]*$/.test(name);
const skipped = new Set(["ShadowRealm", "stdin", "stdout", "stderr", "openStdin", "mainModule", "binding", "_linkedBinding", "repl", "$", "argv", "execArgv", "env", "main", "arguments", "caller", "callee", "globalThis", "self", "global"]);
const isObject = value => value !== null && (typeof value === "object" || typeof value === "function");
const paths = [], modules = [];
function read(holder, name) {
  try {
    const value = holder[name];
    if (value instanceof Promise) value.catch(() => {});
    return value;
  } catch {}
}
function walk(text, value, depth, seen) {
  paths.push(text);
  if (depth === 0 || seen.has(value)) return;
  seen.add(value);
  for (const name of Object.getOwnPropertyNames(value).sort()) {
    if (!isName(name) || skipped.has(name)) continue;
    const member = read(value, name);
    if (isObject(member)) walk(text + "." + name, member, depth - 1, seen);
  }
}
walk("globalThis", globalThis, 3, new Set());
const left = /^(_|bun:(main|wrap|internal|test|ffi|jsc)|(node:)?(test|repl|inspector|wasi|trace_events|sqlite)(\\/|$))/;
for (const name of require("node:module").builtinModules.filter(name => !left.test(name)).sort()) {
  let value;
  try { value = require(name); } catch { continue; }
  if (!isObject(value)) continue;
  walk("m" + modules.length, value, 1, new Set());
  modules.push(name);
}
console.log(JSON.stringify({ paths: paths.map(path => path.replace(/^globalThis\\./, "")), modules }));
process.exit(0);
`;

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function plainAndCompiled(dir: string, entry: string) {
  const plain = await run([bunExe(), entry], dir);
  const executable = join(dir, entry.replace(/\.[a-z]+$/, ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", executable], dir);
  expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });
  const compiled = await run([executable], dir);
  return { plain, compiled };
}

test.concurrent.each(questions)(
  "%s, in a function of its own for every global and every member of a built-in module",
  async question => {
    using dir = tempDir("aot-every-built-in-object", { "list.cjs": listPaths });
    const listed = await run([bunExe(), "list.cjs"], String(dir));
    const { paths, modules }: { paths: string[]; modules: string[] } = JSON.parse(listed.stdout);
    expect(paths.length).toBeGreaterThan(1000);
    expect(paths).toContain("console");
    const lines = modules.map((name, index) => `const m${index} = require(${JSON.stringify(name)});`);
    lines.push("const said = [];");
    paths.forEach((path, index) => {
      lines.push(`function ask${index}() { return ${question.replace("PATH", path)}; }`);
      lines.push(`said.push(${JSON.stringify(path)} + " " + ask${index}());`);
    });
    lines.push(`console.log(said.join("\\n"));`, "process.exit(0);");
    await Bun.write(join(String(dir), "asks.cjs"), lines.join("\n") + "\n");
    const { plain, compiled } = await plainAndCompiled(String(dir), "asks.cjs");
    expect(plain.stdout.split("\n").length).toBeGreaterThan(paths.length);
    const expected = plain.stdout.split("\n");
    const differing = compiled.stdout.split("\n").filter((line, index) => line !== expected[index]);
    expect({ differing, exitCode: compiled.exitCode }).toEqual({ differing: [], exitCode: plain.exitCode });
  },
  600_000,
);

const alone: Record<string, string> = {
  "in a function": `function f() { return OBJECT instanceof Object; }\nconsole.log(f());`,
  "handed in as an argument": `function f(value) { return value instanceof Object; }\nconsole.log(f(OBJECT));`,
  "in an arrow function": `const f = () => OBJECT instanceof Object;\nconsole.log(f());`,
  "in an arrow function handed to map": `console.log([1].map(() => OBJECT instanceof Object).join());`,
  "in an async function": `async function f() { return OBJECT instanceof Object; }\nf().then(value => console.log(value));`,
  "in a method": `class C { method() { return OBJECT instanceof Object; } }\nconsole.log(new C().method());`,
  "in the initializer of a field": `class C { field = OBJECT instanceof Object; }\nconsole.log(new C().field);`,
  "at the top level": `console.log(OBJECT instanceof Object);`,
  "asked of its prototype": `function f() { return Object.getPrototypeOf(OBJECT) instanceof Object; }\nconsole.log(f());`,
  "asked of an object made with it as the prototype": `function f() { return Object.create(OBJECT) instanceof Object; }\nconsole.log(f());`,
  "against a function whose prototype is Object.prototype": `function F() {}\nF.prototype = Object.prototype;\nfunction f() { return OBJECT instanceof F; }\nconsole.log(f());`,
};
const objects = ["console", `require("node:console")`, "Bun.sql", "Bun.postgres", `require("node:buffer").SlowBuffer`];
const forms = objects.flatMap(object => Object.entries(alone).map(([where, text]) => [object, where, text] as const));

test.concurrent.each(forms)(
  "%s instanceof Object, %s, alone in its program",
  async (object, _, text) => {
    using dir = tempDir("aot-one-built-in-object", { "main.cjs": text.replaceAll("OBJECT", object) + "\n" });
    const { plain, compiled } = await plainAndCompiled(String(dir), "main.cjs");
    expect(plain.stdout).toBe("true\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      exitCode: plain.exitCode,
    });
  },
  600_000,
);
