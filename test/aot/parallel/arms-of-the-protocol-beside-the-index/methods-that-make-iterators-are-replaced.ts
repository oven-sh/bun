function values(map: Map<string, number>): string { let text = ""; for (const value of map.values()) text += value + ";"; return text; }
function keys(map: Map<string, number>): string { let text = ""; for (const key of map.keys()) text += key + ";"; return text; }
function makeMap(from: number): Map<string, number> { const map = new Map<string, number>(); for (let i = 0; i < 2; i++) map.set("k" + i, from + i); return map; }
class Odd extends Map<string, number> { values(): any { return [70, 71][Symbol.iterator](); } }
let out = ""; for (let round = 0; round < 30; round++) { let map = makeMap(round);
  if (round === 26) (map as any).values = function* () { yield 80; };
  if (round === 27) Object.setPrototypeOf(map, { __proto__: Map.prototype, keys() { return ["above"][Symbol.iterator](); } });
  if (round === 28) map = new Odd([["o", 1]]);
  if (round === 29) Object.defineProperty(map, "keys", { get() { return () => ["got"][Symbol.iterator](); } });
  out += values(map) + keys(map) + "|"; } console.log(out.slice(-150));
