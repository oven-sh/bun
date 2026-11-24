// COUNT: operation:operationAOTCopyDataProperties <= 2
type S = { tick: number; a: number; b: string; c: number[]; d: { at: number }; e?: number; f: boolean };
function show(o: any): string {
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, key)!;
    parts.push(String(key) + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + ("value" in d ? (d.writable ? "w" : "") + "=" + JSON.stringify(d.value) : (d.get ? "G" : "") + (d.set ? "S" : "")));
  }
  let walked = ""; for (const key in o) walked += key + ",";
  return parts.join(" ") + " | " + walked + " | " + JSON.stringify(o) + " | " + Object.getPrototypeOf(o === null ? {} : o)?.constructor?.name + " | " + Object.isFrozen(o) + Object.isSealed(o) + Object.isExtensible(o);
}
function first(seed: number): S { return { tick: 0, a: seed, b: "b" + seed, c: [seed], d: { at: seed }, e: seed + 0.5, f: seed % 2 === 0 }; }
type L = { tick: number; v: number | string | null | { n: number } };
function stepL(o: L, t: number): L { return { ...o, tick: t }; }
let loose: L = { tick: 0, v: 1 };
function turn(o: S, r: number): S { loose = stepL(loose, r); loose.v = r % 4 === 0 ? 1.5 : r % 4 === 1 ? 'text' : r % 4 === 2 ? null : { n: r }; loose = stepL(loose, r); return { ...o, b: JSON.stringify(loose), tick: r }; }
const rounds: number = JSON.parse("9");
const out: string[] = [];
let state: S = first(1);
for (let r = 0; r < rounds; r++) { state = turn(state, r); out.push(r + " " + show(state)); }
Bun.gc(true); for (let filler = 0; filler < 2000; filler++) (globalThis as any).lastFiller = { at: "filler" + filler, more: [filler] }; Bun.gc(true);
out.push("later " + show(state));
console.log(out.join("\n"));
