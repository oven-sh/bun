import { names, makeLiteral } from "./lit";
const N = 15000;
const zeroOf = makeLiteral();
function loopBuilt(): Record<string, unknown> { const o: Record<string, unknown> = {}; for (const n of names) o[n] = zeroOf[n]; return o; }
// JSON text with null where the zero is undefined; the nulls are then overwritten in place.
function viaJson(): Record<string, unknown> {
  const o = JSON.parse("{" + names.map(n => `${JSON.stringify(n)}:${JSON.stringify(zeroOf[n]) ?? "null"}`).join(",") + "}");
  for (const n of names) if (zeroOf[n] === undefined) o[n] = undefined;
  return o;
}
// Two halves of at most 64 names each, filled by a loop, then spread into one literal.
function viaHalves(): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [];
  for (let i = 0; i < names.length; i += 60) { const o: Record<string, unknown> = {}; for (const n of names.slice(i, i + 60)) o[n] = zeroOf[n]; parts.push(o); }
  return { ...parts[0], ...parts[1], ...parts[2] };
}
const templates: [string, Record<string, unknown>][] = [
  ["loop-built", loopBuilt()],
  ["JSON.parse, nulls overwritten", viaJson()],
  ["three loop-built parts of 60 spread into one", viaHalves()],
  ["structuredClone of loop-built", structuredClone(loopBuilt())],
  ["literal", makeLiteral()],
];
for (let round = 0; round < 4; round++) {
  for (const [name, template] of templates) {
    const c0 = process.cpuUsage();
    let x = 0;
    for (let i = 0; i < N; i++) {
      const o: any = { ...template };
      o.target = i & 7;
      o["base" + "Url"] = "/x";
      x += o.target + (o.module | 0);
    }
    const c = process.cpuUsage(c0);
    if (round === 3) console.log(`${((c.user + c.system) / 1000).toFixed(1).padStart(7)} ms for ${N} spreads of: ${name}; keys in order: ${Object.keys({ ...template }).join() === names.join()}`);
  }
}
