// The directive names that reach a configuration, by the table that knows them (research probe).
import { enumerateInstances } from "./compiler_runner";
import { getCommandLineOption, getHarnessOption } from "./harnessutil";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot: root });
const run = new Map<string, number>();
for (const i of e.instances) {
  if (i.status !== "run" || i.config === undefined) continue;
  for (const k of i.config.keys()) run.set(k, (run.get(k) ?? 0) + 1);
}
const compiler: string[] = [], harness: string[] = [], other: string[] = [];
for (const [k, n] of [...run].sort((a, b) => b[1] - a[1])) {
  const c = getCommandLineOption(k);
  if (k === "typescriptversion") other.push(`${k}:${n}`);
  else if (c) compiler.push(`${c.name}(${c.kind}):${n}`);
  else if (getHarnessOption(k)) harness.push(`${getHarnessOption(k)!.name}:${n}`);
  else other.push(`${k}:${n}`);
}
console.log("compiler options in run instances:", compiler.length);
console.log(compiler.join(" "));
console.log("harness options:", harness.join(" "));
console.log("other:", other.join(" "));
