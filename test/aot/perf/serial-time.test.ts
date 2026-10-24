// How much of `bun build --compile --aot` runs on one thread while the other cores wait.
//
// With BUN_JSC_logAOTPhaseTimes=1 the compiler prints, for each named phase, the CPU time its coordinating thread spent
// outside parallel loops. Only the phases of the stages count: the lines of a pass lie inside them. A generated program is
// built at two sizes. What one more module adds to a phase's serial time is
// divided by what it adds to the CPU time of the whole build, so the number does not depend on the machine's speed. It is
// given in parts per million. For scale: one walk over every value of the program on one thread is about 500, and between
// two runs on a busy machine a phase moves by up to 300.
//
//   bun test test/aot/perf/serial-time.test.ts                   prints the table; fails if a phase takes more than twice
//                                                                its number in ./serial-time.<os>-<arch>.json plus 500,
//                                                                or if all phases together do
//   AOT_PERF=update bun test test/aot/perf/serial-time.test.ts   rewrites that file
//
// A phase that is not in the file counts as 0 there. Where the file is missing the table is printed and not judged, and on
// musl too, because the numbers in the file are those of glibc. The
// option must only print: the executable has to be the same bytes with and without it.
import { expect } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { test } from "../supported";

const pinsPath = join(import.meta.dir, `serial-time.${process.platform}-${process.arch}.json`);
const sizes = [150, 600];
const runs = 2;
const slack = 500;

function moduleSource(i: number): string {
  const imports = i > 1 ? [...new Set([(i * 7 + 3) % i, i - 1])].sort((a, b) => a - b) : i === 1 ? [0] : [];
  const lines = imports.map(d => `import { f${d}_0, C${d} } from "./m${d}";`);
  lines.push(`export interface I${i} { id: number; name: string; tags: string[]; next?: I${i}; w${i % 50}: number }`);
  lines.push(
    `export class C${i} {`,
    `  items: I${i}[] = [];`,
    "  total = 0;",
    "  constructor(public label: string) {}",
  );
  for (let j = 0; j < 5; j++)
    lines.push(
      `  m${j}(x: number): number { let s = this.total; for (const it of this.items) { if (it.id > x) s += it.w${i % 50}; else s -= it.name.length; } this.total = s; return s + ${j}; }`,
    );
  lines.push(
    `  add(id: number, name: string) { this.items.push({ id, name, tags: [name, this.label], w${i % 50}: id * 2 }); return this; }`,
    "}",
  );
  for (let j = 0; j < 10; j++) {
    const call = j ? `f${i}_${j - 1}(n - 1)` : imports.length ? `f${imports[0]}_0(n - 1)` : "n";
    lines.push(
      `export function f${i}_${j}(n: number): number {`,
      `  if (n <= 0) return ${j};`,
      `  const o = { a: n, b: "k${i}_${j}", c: [n, n + 1] };`,
      "  let s = 0;",
      "  for (let q = 0; q < o.c.length; q++) s += o.c[q] * o.a;",
      `  const g = (y: number) => y + s + o.b.length;`,
      `  return g(${call}) % 1000003;`,
      "}",
    );
  }
  for (let j = 0; j < 2; j++) {
    lines.push(
      `export async function a${i}_${j}(p: Promise<number>): Promise<string> { const v = await p; const c = new C${i}(\`l\${v}\`); c.add(v, "n${i}").add(v + 1, \`x\${v}y\`); return \`\${c.m0(v)}:\${/^a${i}+b/.test(c.label)}\`; }`,
    );
    lines.push(
      `export function* g${i}_${j}(n: number) { for (let k = 0; k < n; k++) { const r = { k, i: ${i} }; yield r.k + r.i; } }`,
    );
    lines.push(
      `export const t${i}_${j}: Record<string, number> = { ${Array.from({ length: 8 }, (_, q) => `k${q}: ${q * i}`).join(", ")} };`,
    );
  }
  return lines.join("\n") + "\n";
}

function program(modules: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < modules; i++) files[`m${i}.ts`] = moduleSource(i);
  const main = Array.from({ length: modules }, (_, i) => `import * as M${i} from "./m${i}";`);
  main.push("let total = 0;", "const keep: unknown[] = [];");
  for (let first = 0; first < modules; first += 50) {
    const some = Array.from({ length: Math.min(50, modules - first) }, (_, k) => first + k);
    main.push(`function k${first}(a: unknown[]) { ${some.map(i => `a.push(M${i});`).join(" ")} }`, `k${first}(keep);`);
    main.push(`total += M${first}.f${first}_9(3);`);
  }
  main.push("console.log(total, keep.length);");
  files["main.ts"] = main.join("\n") + "\n";
  return files;
}

type Build = { cpu: number; phases: Map<string, number>; hash: number | bigint };

function build(folder: string, logs: boolean): Build {
  const executable = join(folder, isWindows ? "main.exe" : "main");
  const built = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", executable],
    cwd: folder,
    env: logs ? { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" } : bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = built.stderr.toString();
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? stderr.slice(-2000) : "" }).toEqual({
    exitCode: 0,
    stderr: "",
  });
  const phases = new Map<string, number>();
  for (const line of stderr.split("\n")) {
    const found =
      /^AOT phase times: (?!pass )(.+?) \| wall [-\d.e]+ ms \| .*\| outside parallel loops ([-\d.e]+) ms \|/.exec(line);
    if (found) phases.set(found[1], (phases.get(found[1]) ?? 0) + Number(found[2]));
  }
  return { cpu: Number(built.resourceUsage!.cpuTime.total) / 1000, phases, hash: Bun.hash(readFileSync(executable)) };
}

function quickest(modules: number): Build {
  using dir = tempDir(`aot-serial-time-${modules}`, program(modules));
  const builds = Array.from({ length: runs }, () => build(String(dir), true));
  expect(build(String(dir), false).hash).toBe(builds[0].hash);
  const phases = new Map<string, number>();
  for (const name of builds[0].phases.keys())
    phases.set(name, Math.min(...builds.map(one => one.phases.get(name) ?? 0)));
  return { cpu: Math.min(...builds.map(one => one.cpu)), phases, hash: builds[0].hash };
}

test("compile/aot/perf/serial-time", () => {
  const [small, large] = sizes.map(quickest);
  expect(large.phases.size).toBeGreaterThan(50);

  const cpu = large.cpu - small.cpu;
  expect(cpu).toBeGreaterThan(0);
  const now: Record<string, number> = { "all phases": 0 };
  for (const [name, time] of large.phases) {
    now[name] = Math.max(0, Math.round(((time - (small.phases.get(name) ?? 0)) / cpu) * 1e6));
    now["all phases"] += now[name];
  }
  if (process.env.AOT_PERF === "update") writeFileSync(pinsPath, JSON.stringify(now, null, 2) + "\n");
  const isJudged = existsSync(pinsPath) && !isMusl;
  const pins: Record<string, number> = isJudged ? JSON.parse(readFileSync(pinsPath, "utf8")) : {};
  const names = Object.keys(now).sort((a, b) => now[b] - now[a]);
  console.log("serial time in parts per million of the build's CPU time: now, pinned");
  for (const name of names.filter(name => now[name] >= 100 || (pins[name] ?? 0) >= 100))
    console.log(`${String(now[name]).padStart(8)}${String(pins[name] ?? 0).padStart(8)}  ${name}`);
  if (!isJudged)
    return void console.error(`NOT JUDGED: ${isMusl ? "the pins are those of glibc" : `${pinsPath} is missing`}`);
  const worse = names
    .filter(name => now[name] > 2 * (pins[name] ?? 0) + slack)
    .map(name => `${name}: ${now[name]}, pinned ${pins[name] ?? 0}`);
  expect(worse).toEqual([]);
}, 600_000);
