// The instances whose two error baselines differ in bytes and have no diff file (research probe).
import { existsSync, readFileSync } from "node:fs";
import { enumerateInstances, type Instance } from "./compiler_runner";
const tsgo = "/workspace/ref/typescript-go/testdata/baselines/reference";
const ts = "/workspace/ref/typescript-go/_submodules/TypeScript/tests";
const e = enumerateInstances({ casesRoot: ts + "/cases" });
const stem = (i: Instance) => i.name.replace(/\.tsx?$/, "");
// compiler_runner.go:393 DiffFixupOld
const fixup = (old: string) => old.split("\n").map(l => (l.startsWith("==== ./") ? "==== " + l.slice(7) : l)).join("\n");
let n = 0, explained = 0;
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const a = `${tsgo}/submodule/${i.suite}/${stem(i)}.errors.txt`;
  const b = `${ts}/baselines/reference/${stem(i)}.errors.txt`;
  if (!existsSync(a) || !existsSync(b)) continue;
  const ta = readFileSync(a, "latin1"), tb = readFileSync(b, "latin1");
  if (ta === tb) continue;
  const hasDiff = ["submodule", "submoduleAccepted", "submoduleTriaged"].some(r => existsSync(`${tsgo}/${r}/${i.suite}/${stem(i)}.errors.txt.diff`));
  if (hasDiff) continue;
  n++;
  const ok = ta === fixup(tb);
  if (ok) explained++;
  console.log(i.suite + "/" + stem(i), ok ? "equal after the ./ fixup" : "NOT explained by the fixup");
}
console.log("total", n, "explained", explained);
