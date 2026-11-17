// Times what two builds of Bun compile, on one machine and in turns: one that signs return addresses and one that does not.
// `again` is the second once more, which shows how far two series of the same executable lie apart.
//   bun scripts/compare-signed-builds.ts <signed bun> <unsigned bun> [part/parts]
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { everydayIdioms } from "../test/aot/perf/everyday-idioms.ts";

const [signed, unsigned, share = "1/1"] = process.argv.slice(2);
const [part, parts] = share.split("/").map(Number);
const buns = { signed: resolve(signed), unsigned: resolve(unsigned) };
const kinds = ["signed", "unsigned"] as const;
const folder = mkdtempSync(join(tmpdir(), "compare-signed-builds-"));
const env = { PATH: process.env.PATH, HOME: folder, TMPDIR: folder, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0" };
const oneIdiomIn = 6;
const starts = 7;

const host = `const wanted = Number(process.env.NANOSECONDS);
let turns = 256, began = 0, rounds = -1, best = Infinity, isCalibrated = process.env.TURNS !== undefined;
if (isCalibrated) turns = Number(process.env.TURNS);
export function nextTurns(_check: number): number {
  const took = Bun.nanoseconds() - began;
  if (rounds++ >= 0) {
    if (!isCalibrated) {
      if (took >= wanted || turns >= 2 ** 28) return console.error("turns " + turns), 0;
      turns *= 2;
    } else {
      best = Math.min(best, took);
      if (rounds === 6) return console.error("best " + best), 0;
    }
  }
  began = Bun.nanoseconds();
  return turns;
}
`;

const loop = (turn: string, isAsync = false) => `import { nextTurns } from "../host.ts";
${turn}
let answer = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(answer))
  for (let i = 0; i < n; i++) answer = (answer + ${isAsync ? "(await turn(i))" : "turn(i)"}) & 0xffffff;
console.log(answer);
`;

const fibInWebAssembly =
  "0061736d0100000001060160017f017f030201000707010366696200000a1e011c002000410248047f200005200041016b1000200041026b10006a0b0b";

const wholePrograms = [
  {
    name: "whole/nothing-but-calls",
    text: loop(`function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
const turn = (i: number) => fib(12 + (i & 1));`),
  },
  {
    name: "whole/trees-of-objects",
    text: loop(`class Tree { constructor(readonly left: Tree | null, readonly right: Tree | null) {}
  count(): number { return 1 + (this.left ? this.left.count() + this.right!.count() : 0); } }
function grow(depth: number): Tree { return depth ? new Tree(grow(depth - 1), grow(depth - 1)) : new Tree(null, null); }
const turn = (i: number) => grow(6 + (i & 1)).count();`),
  },
  {
    name: "whole/chain-of-awaits",
    text: loop(
      `async function down(n: number): Promise<number> { if (!n) { await null; return 0; } return (await down(n - 1)) + 1; }
const turn = (i: number) => down(8 + (i & 1));`,
      true,
    ),
  },
  {
    name: "whole/delegating-generators",
    text: loop(`function* walk(n: number): Generator<number> { yield n; if (n) { yield* walk(n - 1); yield* walk(n - 1); } }
function turn(i: number) { let sum = 0; for (const n of walk(4 + (i & 1))) sum += n; return sum; }`),
  },
  {
    name: "whole/throw-through-frames",
    text: loop(`function down(n: number): number { if (!n) throw n; return down(n - 1) + 1; }
function turn(i: number) { try { return down(16 + (i & 1)); } catch (e) { return e as number; } }`),
  },
  {
    name: "whole/errors-with-stacks",
    text: loop(`function down(n: number): number { return n ? down(n - 1) + 1 : new Error("x").stack!.length; }
const turn = (i: number) => down(8 + (i & 1));`),
  },
  {
    name: "whole/json",
    text: loop(`const rows = Array.from({ length: 50 }, (_, id) => ({ id, name: "row " + id, tags: ["a", "b"], at: id / 3 }));
const turn = (i: number) => JSON.parse(JSON.stringify(rows))[i % 50].id;`),
  },
  {
    name: "whole/regular-expressions",
    text: loop(`const lines = Array.from({ length: 20 }, (_, id) => "2026-01-" + (10 + id) + " GET /a/" + id + "?b=c 200 " + id / 7);
function turn(i: number) { let sum = 0; for (const line of lines) sum += /^(\\d+)-(\\d+)-(\\d+) (\\w+) (\\S+?)(?:\\?(\\S*))? (\\d+)/.exec(line)![5].length + line.replace(/\\d+/g, "#").length; return sum + i; }`),
  },
  {
    name: "whole/maps-with-text-keys",
    text: loop(`const keys = Array.from({ length: 64 }, (_, id) => "key" + id);
function turn(i: number) { const map = new Map<string, number>(); for (const key of keys) map.set(key + (i & 1), i); let sum = 0; for (const key of keys) sum += map.get(key + "0") ?? 1; return sum; }`),
  },
  {
    name: "whole/evaluated-calls",
    text: loop(`const fib = new Function("return function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); } // " + process.pid)();
const turn = (i: number): number => fib(10 + (i & 1));`),
  },
  {
    name: "whole/evaluated-tail-calls",
    text: loop(`const down = new Function("'use strict'; return function down(n, sum) { return n ? down(n - 1, sum + n) : sum; } // " + process.pid)();
const turn = (i: number): number => down(100 + (i & 1), 0);`),
  },
  {
    name: "whole/webassembly-calls",
    text: loop(`import path from "../fib.wasm";
const { fib } = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()))).exports as { fib(n: number): number };
const turn = (i: number) => fib(12 + (i & 1));`),
  },
  {
    name: "whole/serve-and-fetch",
    text:
      loop(
        `const server = Bun.serve({ port: 0, fetch: request => Response.json({ path: new URL(request.url).pathname }) });
const turn = async (i: number) => (await (await fetch(server.url + "x" + i)).text()).length;`,
        true,
      ) + "server.stop(true);\n",
  },
  {
    name: "whole/typescript-transpiles",
    text: loop(`import ts from "typescript";
const text = Array.from({ length: 4 }, (_, k) => \`export function f\${k}<T>(x: T, y?: number): T[] { for (const z of [x]) if (y ?? z) return [x, z]; return []; }
enum E\${k} { a, b }
export class C\${k} { constructor(private y: number) {} async m() { return (await this.y) + E\${k}.b; } }\`).join("\\n");
const turn = (_: number) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2015 } }).outputText.length;`),
  },
];

async function run(cmd: string[], extra: Record<string, string> = {}) {
  const began = Bun.nanoseconds();
  await using child = Bun.spawn({
    cmd,
    cwd: folder,
    env: { ...env, ...extra },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  if (exitCode !== 0) throw new Error(`exit code ${exitCode}: ${(stderr + stdout).trim().slice(0, 200)}`);
  const { user, system } = child.resourceUsage()!.cpuTime;
  return { stdout, stderr, wall: Bun.nanoseconds() - began, cpu: Number(user + system) * 1000 };
}

const executableOf = (kind: string, name: string) => join(folder, `${kind}-${name.replaceAll("/", "-")}`);
const build = (kind: (typeof kinds)[number], name: string) =>
  run([buns[kind], "build", "--compile", "--aot", join(folder, name + ".ts"), "--outfile", executableOf(kind, name)]);

async function leastOf(times: number, measure: (kind: (typeof kinds)[number]) => Promise<number>) {
  const least = { signed: Infinity, unsigned: Infinity, again: Infinity };
  const series = ["signed", "unsigned", "again"] as const;
  for (let time = 0; time < times; time++)
    for (const one of time & 1 ? series.toReversed() : series)
      least[one] = Math.min(least[one], await measure(one === "again" ? "unsigned" : one));
  return least;
}

const report = (name: string, unit: string, readings: Record<string, number>) =>
  console.log(`READING ${JSON.stringify({ name, unit, ...readings })}`);

async function time(name: string) {
  const { stderr } = await run([executableOf("unsigned", name)], { NANOSECONDS: "15000000" });
  const turns = /^turns (\d+)/m.exec(stderr)![1];
  const answers = new Set<string>();
  const least = await leastOf(starts, async kind => {
    const { stdout, stderr } = await run([executableOf(kind, name)], { TURNS: turns });
    answers.add(stdout);
    return Number(/^best (\d+)/m.exec(stderr)![1]) / Number(turns);
  });
  report(name, answers.size === 1 ? "ns" : "ns, answers differ", least);
}

console.log(cpus()[0].model, availableParallelism());
writeFileSync(join(folder, "host.ts"), host);
writeFileSync(join(folder, "fib.wasm"), Buffer.from(fibInWebAssembly, "hex"));
mkdirSync(join(folder, "node_modules"));
symlinkSync(resolve(import.meta.dir, "../node_modules/typescript"), join(folder, "node_modules/typescript"));

const idioms = everydayIdioms(true).filter((_, index) => index % (oneIdiomIn * parts) === (part - 1) * oneIdiomIn);
const programs = [...wholePrograms, { name: "whole/start", text: "console.log(1);\n" }, ...idioms];
for (const { name, text } of programs) {
  mkdirSync(dirname(join(folder, name)), { recursive: true });
  writeFileSync(join(folder, name + ".ts"), text);
}

for (const name of ["whole/typescript-transpiles", "whole/start"]) {
  const cpu = { signed: Infinity, unsigned: Infinity };
  const wall = await leastOf(2, async kind => {
    const built = await build(kind, name);
    cpu[kind] = Math.min(cpu[kind], built.cpu);
    return built.wall;
  });
  report(`build/${name}`, "ns of the clock", wall);
  report(`build/${name}`, "ns of processors", cpu);
  report(`size/${name}`, "bytes", {
    signed: statSync(executableOf("signed", name)).size,
    unsigned: statSync(executableOf("unsigned", name)).size,
  });
}
report("size/bun", "bytes", { signed: statSync(buns.signed).size, unsigned: statSync(buns.unsigned).size });
report("start", "ns", await leastOf(200, async kind => (await run([executableOf(kind, "whole/start")])).wall));

for (const { name } of programs) {
  if (name === "whole/start") continue;
  try {
    if (name !== "whole/typescript-transpiles") await Promise.all(kinds.map(kind => build(kind, name)));
    await time(name);
  } catch (error) {
    console.log(`FAILS ${name}: ${String(error).replaceAll("\n", " / ")}`);
  }
  for (const kind of kinds) rmSync(executableOf(kind, name), { force: true });
}
rmSync(folder, { recursive: true });
