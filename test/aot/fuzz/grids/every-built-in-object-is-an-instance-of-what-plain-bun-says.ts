import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { afterAll, test } from "../../harness/default-timeout";

// A walk of plain Bun at test time: every global to depth 3 and every member of the built-in modules. What it once found is held by
// ../../every-built-in-object-is-an-instance-of-what-plain-bun-says.test.ts.
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

// One program asks all six of every path. Each question of each path has a function of its own, as it had, and the modules of the library, which are nearly all that such a
// build compiles, are compiled once and not six times.
type Asked = { paths: string[]; plain: Awaited<ReturnType<typeof run>>; compiled: Awaited<ReturnType<typeof run>> };
let asked: Promise<Asked> | undefined;
let folder: ReturnType<typeof tempDir> | undefined;
afterAll(() => folder?.[Symbol.dispose]());
const askEveryPath = () =>
  (asked ??= (async () => {
    const dir = (folder = tempDir("aot-every-built-in-object", { "list.cjs": listPaths }));
    const listed = await run([bunExe(), "list.cjs"], String(dir));
    const { paths, modules }: { paths: string[]; modules: string[] } = JSON.parse(listed.stdout);
    const lines = modules.map((name, index) => `const m${index} = require(${JSON.stringify(name)});`);
    lines.push("const said = [];");
    questions.forEach((question, nth) =>
      paths.forEach((path, index) => {
        lines.push(`function ask${nth}_${index}() { return ${question.replace("PATH", path)}; }`);
        lines.push(`said.push(${JSON.stringify(`${nth} ${path}`)} + " " + ask${nth}_${index}());`);
      }),
    );
    lines.push(`console.log(said.join("\\n"));`, "process.exit(0);");
    await Bun.write(join(String(dir), "asks.cjs"), lines.join("\n") + "\n");
    return { paths, ...(await plainAndCompiled(String(dir), "asks.cjs")) };
  })());

test.concurrent.each(questions.map((question, nth) => [question, nth] as const))(
  "%s, in a function of its own for every global and every member of a built-in module",
  async (_, nth) => {
    const { paths, plain, compiled } = await askEveryPath();
    expect(paths.length).toBeGreaterThan(1000);
    expect(paths).toContain("console");
    const answersIn = (stdout: string) => stdout.split("\n").filter(line => line.startsWith(`${nth} `));
    const expected = answersIn(plain.stdout);
    expect(expected.length).toBe(paths.length);
    const differing = answersIn(compiled.stdout).filter((line, index) => line !== expected[index]);
    expect({ differing, exitCode: compiled.exitCode }).toEqual({ differing: [], exitCode: plain.exitCode });
  },
  600_000,
);
