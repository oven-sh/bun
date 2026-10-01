import { newCompilerOptions } from "/tmp/rtb1b/repo/test/cli/lint/conformance/runner/tsconfig";
import { makeLiteral, template, names } from "./lit";
const N = 15000;
const zero = newCompilerOptions() as Record<string, unknown>;
// A template made once by a spread of the loop-built object, then spread per call.
const respread: Record<string, unknown> = { ...zero };
const respread2: Record<string, unknown> = { ...respread };
const fromLiteral = makeLiteral();
const viaAssign: Record<string, unknown> = Object.assign({}, zero);
const viaEntries: Record<string, unknown> = Object.fromEntries(Object.entries(zero));
function loopBuilt(): Record<string, unknown> { const o: Record<string, unknown> = {}; for (const n of names) o[n] = zero[n]; return o; }
const loop1 = loopBuilt();
const variants: [string, () => any][] = [
  ["{...zero} (zero = result of the spread of the loop-built object, as now)", () => ({ ...zero })],
  ["{...respread} (respread = {...zero})", () => ({ ...respread })],
  ["{...respread2} (respread2 = {...respread})", () => ({ ...respread2 })],
  ["{...fromLiteral} (fromLiteral = makeLiteral())", () => ({ ...fromLiteral })],
  ["{...template} (module-level literal)", () => ({ ...template })],
  ["{...viaAssign}", () => ({ ...viaAssign })],
  ["{...viaEntries}", () => ({ ...viaEntries })],
  ["{...loop1} (a loop-built object)", () => ({ ...loop1 })],
  ["makeLiteral()", () => makeLiteral()],
  ["{...makeLiteral()}", () => ({ ...makeLiteral() })],
];
for (let round = 0; round < 4; round++) {
  for (const [name, make] of variants) {
    const c0 = process.cpuUsage();
    let x = 0;
    for (let i = 0; i < N; i++) {
      const o = make();
      o.target = i & 7;
      o.strict = 2;
      o["base" + "Url"] = "/x";
      x += o.target + o.strict + (o.baseUrl === "" ? 1 : 0) + (o.module | 0);
    }
    const c = process.cpuUsage(c0);
    if (round === 3) console.log(`${((c.user + c.system) / 1000).toFixed(1).padStart(7)} ms for ${N}  ${name}`);
  }
}
