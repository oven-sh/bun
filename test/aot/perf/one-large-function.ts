import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const kinds: Record<string, (i: number) => string> = {
  map: i => `  r.push(a.map((x: any) => x + ${i}).length);`,
  method: i => `  r.push(o.m${i % 7}(${i}, ${i + 1}));`,
  literal: i => `  { const p = { x: ${i}, y: a, z: "k${i % 13}" }; r.push(p.x + p.y.length + p.z.length); }`,
  closure: i => `  { const g = (y: number) => y + a.length + ${i}; r.push(g(${i})); }`,
  read: i => `  r.push(o.f${i % 11} > ${i} ? o.f${i % 5} : o.g${i % 3});`,
  elements: i => `  r.push(h("div", { id: "k${i}", n: ${i}, on: () => a.length + ${i} }, h("span", { c: o.f${i % 11} }, "t${i}")));`,
  await: i => `  r.push(await o.p(${i}));`,
  try: i => `  try { r.push(o.m${i % 7}(${i}, 1)); } catch (e) { r.push(e); }`,
  template: i => "  r.push(`a${o.f" + (i % 11) + "}b${" + i + "}c${a.length}`);",
  yield: i => `  { const v${i} = o.m${i % 7}(${i}, a.length); r.push(yield v${i}); if (v${i} > ${i}) r.push(v${i} + first); }`,
  chain: i => `  const c${i + 1} = o.m${i % 7}(c${i}, ${i});`,
  optional: i => `  r.push(o?.q${i % 9}?.z ?? o.f${i % 11});`,
  loop: i => `  for (const x of a) r.push(x + ${i});`,
  destructure: i => `  { const { f${i % 5}: u, f${5 + (i % 5)}: v, ...rest } = o; r.push(u + v + rest.g0); }`,
  number: i => `  t = (t * ${i + 3} + n % ${i + 2}) | 0; d = d * 1.5 + t / ${i + 1};`,
  captured: i => `  let v${i} = a.length + ${i}; r.push(() => v${i}++);`,
  case: i => `    case ${i}: r.push(o.f${i % 11}); break;`,
  property: i => `    k${i}: o.f${i % 11} + ${i},`,
  element: i => `    { id: ${i}, name: "n${i}", on: o.f${i % 11} },`,
};
const around: Record<string, (n: number) => [string, string]> = {
  yield: () => ["  const first = a.length + o.f1;", ""],
  chain: n => ["  const c0 = a.length;", `  r.push(c${n});`],
  number: () => ["  let t = a.length | 0, d = 0.5; const n: number = a.length;", "  r.push(t, d);"],
  case: () => ["  const n: number = a.length;\n  switch (n) {", "  }"],
  property: () => ["  r.push({", "  });"],
  element: () => ["  r.push([", "  ]);"],
};

const usage = `bun test/aot/perf/one-large-function.ts [--sizes 500,1000,2000,4000] [--most 2.5] [--keep] [kind ..]

How the work of \`bun build --compile --aot\` grows with the size of ONE function. For each kind of statement
(${Object.keys(kinds).join(" ")}) a program whose one large function holds n such statements is built, for n = 0 and
for each size. Printed: what a statement costs on average at each size, over the build of the empty function:
in thousands of instructions where \`perf stat\` can be run, else in milliseconds of processor time.

A step of the compiler that walks the whole function once for each statement shows as a cost that doubles with n.
Exit code 1: for some kind a statement costs over --most times as much at the largest size as at the smallest, or
the smallest size cannot be built. A larger size that the type checker refuses ends the row. It takes minutes; by
processor time it wants a machine that is otherwise still.`;

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args.splice(at, 2)[1];
}
if (args.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
const sizes = (option("--sizes") ?? "500,1000,2000,4000").split(",").map(Number);
const most = Number(option("--most") ?? 2.5);
const keeps = args.includes("--keep") && !!args.splice(args.indexOf("--keep"), 1);
const wanted = args.length ? args : Object.keys(kinds);
for (const kind of wanted) {
  if (!kinds[kind]) {
    console.error(`no such kind: ${kind}\n\n${usage}`);
    process.exit(2);
  }
}

function program(kind: string, n: number): string {
  const lines = ["declare const console: any;"];
  lines.push(`${kind === "await" ? "async " : ""}function${kind === "yield" ? "*" : ""} large(a: any, o: any, h: any, r: any[])${kind === "yield" ? ": any" : ""} {`);
  const [head, foot] = around[kind]?.(n) ?? ["", ""];
  lines.push(head);
  for (let i = 0; i < n; i++) lines.push(kinds[kind](i));
  lines.push(foot, "}");
  lines.push("const o: any = { f0: 1, f1: 2, f2: 3, f3: 4, f4: 5, f5: 6, f6: 7, f7: 8, f8: 9, f9: 10, f10: 11, g0: 1, g1: 2, g2: 3, p(x: number) { return Promise.resolve(x); }, m0(a: number, b: number) { return a + b; }, m1(a: number, b: number) { return a - b; }, m2() { return 1; }, m3() { return 2; }, m4() { return 3; }, m5() { return 4; }, m6() { return 5; } };");
  lines.push("const h = (tag: any, props: any, ...children: any[]) => ({ tag, props, children });");
  lines.push("const out: any[] = [];");
  lines.push(kind === "yield" ? "for (const x of large([1, 2, 3], o, h, out)) out.push(x);" : "large([1, 2, 3], o, h, out);");
  lines.push("console.log(out.length);");
  return lines.join("\n") + "\n";
}

const folder = join(tmpdir(), `one-large-function-${process.pid}`);
mkdirSync(folder, { recursive: true });
const counts = join(folder, "instructions");
const perf = Bun.which("perf");
const countsInstructions =
  !!perf && Bun.spawnSync({ cmd: [perf, "stat", "-x", ",", "-e", "instructions:u", "-o", counts, "--", "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

function build(kind: string, n: number): number | string {
  const source = join(folder, `${kind}-${n}.ts`);
  const executable = join(folder, `${kind}-${n}`);
  writeFileSync(source, program(kind, n));
  const command = [process.execPath, "build", "--compile", "--aot", source, "--outfile", executable];
  const built = Bun.spawnSync({
    cmd: countsInstructions ? [perf!, "stat", "-x", ",", "-e", "instructions:u", "-o", counts, "--", ...command] : command,
    cwd: folder,
    env: { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  rmSync(executable, { force: true });
  if (built.exitCode !== 0) return built.stderr.toString().trim().split("\n").slice(-2).join(" | ").slice(0, 160);
  if (!countsInstructions) return Number(built.resourceUsage.cpuTime.total) / 1e3;
  const line = readFileSync(counts, "utf8").split("\n").find(l => l.includes("instructions"));
  return Number(line!.split(",")[0]) / 1e3;
}

console.log(countsInstructions ? "thousands of instructions a statement" : "milliseconds of processor time a statement");
let failed = false;
for (const kind of wanted) {
  const empty = build(kind, 0);
  const costs: number[] = [];
  let refusal = "";
  for (const n of sizes) {
    const whole = build(kind, n);
    if (typeof whole === "string" || typeof empty === "string") {
      refusal = `  ${n}: not built: ${typeof whole === "string" ? whole : empty}`;
      break;
    }
    costs.push((whole - empty) / n);
  }
  const grows = costs.length > 1 ? costs[costs.length - 1] / costs[0] : 1;
  failed ||= !costs.length || grows > most;
  console.log(`${kind.padEnd(9)}${costs.map(c => c.toFixed(countsInstructions ? 0 : 2).padStart(9)).join("")}   ${grows > most ? "GROWS " : ""}${grows.toFixed(1)} times${refusal}`);
}
if (!keeps) rmSync(folder, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
