// Which compiler options a command line must carry to reach how many run instances (research probe).
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { getCommandLineOption, getHarnessOption } = await import(P + "harnessutil.ts");
import { existsSync } from "node:fs";
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const e = enumerateInstances({ casesRoot });
const run = e.instances.filter((i: any) => i.status === "run");
const sets: { name: string; E: boolean; options: string[] }[] = [];
const use: Record<string, number> = {};
const bySet: Record<string, number> = {};
for (const i of run) {
  const options: string[] = [];
  for (const [k] of i.config ?? []) {
    const c = getCommandLineOption(k);
    if (c !== undefined) options.push(c.name);
  }
  options.sort();
  for (const o of options) use[o] = (use[o] ?? 0) + 1;
  const key = options.join("+") || "(none)";
  bySet[key] = (bySet[key] ?? 0) + 1;
  sets.push({ name: i.name, E: existsSync(baselines + "/" + i.suite + "/" + i.name.replace(/\.tsx?$/, ".errors.txt")), options });
}
const order = Object.entries(use).sort((a, b) => b[1] - a[1]).map(x => x[0]);
console.log("distinct option sets:", Object.keys(bySet).length);
console.log("most frequent sets:", JSON.stringify(Object.entries(bySet).sort((a, b) => b[1] - a[1]).slice(0, 12)));
const have = new Set<string>();
const rows: string[] = [];
for (let k = 0; k < order.length; k++) {
  have.add(order[k]);
  const covered = sets.filter(s => s.options.every(o => have.has(o)));
  if (k < 12 || k % 10 === 9 || k === order.length - 1) rows.push(`${k + 1}\t${order[k]}\t${covered.length}\tE=${covered.filter(s => s.E).length}\tC=${covered.filter(s => !s.E).length}`);
}
console.log("options carried (most used first)\tinstances whose options are all carried");
console.log(rows.join("\n"));
