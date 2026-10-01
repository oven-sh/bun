// Research probe: values of target, lib and strict of the run instances.
import { enumerateCase, inputOf, listCases, referenceLayout } from "/workspace/notes/lint/units/conformance/test-file-and-sweep/top-down/index.ts";
const layout = referenceLayout();
const t = new Map<string, number>(), l = new Map<string, number>(), s = new Map<string, number>(), sl = new Map<string, number>();
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
for (const casePath of listCases(layout.casesRoot)) for (const inst of enumerateCase(layout.casesRoot, casePath)) {
  if (inst.status !== "run") continue;
  const r = inputOf(inst, { layout });
  if (!r.ok) continue;
  const o = r.input.compilerOptions as Record<string, unknown>;
  bump(t, String(o.target ?? "<unset>").toLowerCase());
  bump(s, String(o.strict ?? "<unset>").toLowerCase());
  bump(sl, "skiplibcheck=" + String(o.skiplibcheck ?? "<unset>").toLowerCase() + " skipdefaultlibcheck=" + String(o.skipdefaultlibcheck ?? "<unset>").toLowerCase());
  if (o.lib !== undefined) for (const x of String(o.lib).split(",")) bump(l, x.trim().toLowerCase());
}
const show = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ");
console.log("target:", show(t)); console.log("strict:", show(s)); console.log("libcheck:", show(sl)); console.log("lib entries:", show(l));
