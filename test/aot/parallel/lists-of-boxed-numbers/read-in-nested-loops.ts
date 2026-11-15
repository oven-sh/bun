// STATISTIC: LoopsReversionedForOtherIndexingType >= 5
// Loops inside loops over lists that hold numbers or nothing: NaN, undefined, a hole, -0, infinities and great numbers stand at each place in turn, and some lists change while the inner loop runs.
const shown = (x: unknown): string => typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : String(x);
function read(odd: string, at: number): number[] {
  const list = Array.from({ length: 20 }, (_, i) => (i * 7919) % 103 - 40).join(",").split(",").map(Number);
  switch (odd) {
    case "NaN": list[at] = NaN; break;
    case "undefined": list[at] = undefined as any; break;
    case "hole": list[21 + at] = 3; break;
    case "-0": list[at] = -0; list[0] = NaN; break;
    case "endless": list[at] = Infinity; list[1] = NaN; break;
    case "great": list[at] = 2 ** 53; list[2] = NaN; break;
    case "fraction": list[at] = 2.5; list[3] = NaN; break;
  }
  return list;
}
function sums(list: number[]): number { let t = 0; for (let k = 0; k < 3; k++) for (let i = 0; i < list.length; i++) t += list[i]!; return t; }
function pairs(list: number[]): number { let t = 0; for (let i = 0; i < list.length; i++) { const a = list[i]!; for (let j = 0; j < list.length; j++) if (list[j]! < a) t++; } return t; }
function best(list: number[]): number { let t = 0; for (let k = 0; k < 4; k++) { let most = 0; for (let i = 0; i < 5; i++) { const n = list[k * 5 + i]!; if (n > most) most = n; } t += most; } return t; }
function products(list: number[]): number { let t = 0; for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) t = (t + list[i]! * list[j]!) % 1000003; return t; }
function bits(list: number[]): number { let t = 0; for (let k = 0; k < 3; k++) for (let i = 0; i < list.length; i++) t = (t ^ list[i]!) | 0; return t; }
function swaps(list: number[]): number { for (let i = 0; i < 3; i++) for (let j = 0; j + 1 < list.length; j++) if (list[j]! > list[j + 1]!) { const x = list[j]!; list[j] = list[j + 1]!; list[j + 1] = x; } return list[4]! + list[11]!; }
function changes(list: number[]): number { let t = 0; for (let k = 0; k < 3; k++) for (let i = 0; i < list.length && i < 40; i++) { if (k === 1 && i === 7) list[9] = 0.5; if (k === 1 && i === 12) list.push(NaN); t += list[i]! || 1; } return t; }
for (const odd of ["none", "NaN", "undefined", "hole", "-0", "endless", "great", "fraction"]) {
  const said: string[] = [];
  for (let at = 0; at < 20; at++)
    said.push(shown(sums(read(odd, at))) + " " + shown(pairs(read(odd, at))) + " " + shown(best(read(odd, at))) + " " + shown(products(read(odd, at))) + " " + shown(bits(read(odd, at))) + " " + shown(swaps(read(odd, at))) + " " + shown(changes(read(odd, at))));
  console.log(odd, said.join(", "));
}
