// the tested field holds what is written as a number and is none, or no integer: NaN, the zeroes, fractions, doubles that are whole, texts that look like the cases
type Item = { kind: number; text: string };
function pick(item: Item) { if (item.kind === 0 || item.kind === 4) return "listed"; return "none"; }
function tell(item: Item) { if (item.kind === 0) return "zero"; else if (item.kind === 4) return "four"; else if (item.kind === -1) return "minus one"; return "other"; }
const given: any[] = JSON.parse('[0, -0, 4, 4.0, 4.5, -1, "4", "0", "", null, true, false, [4], {"valueOf": 4}, 1e21, 4294967300]');
given.push(NaN, -0, 2 ** 32 + 4, 8 / 2, undefined, 4n);
for (let i = 0; i < given.length; i++) console.log(String(i), pick({ kind: given[i], text: "t" }), tell({ kind: given[i], text: "t" }));
let told = "";
for (let i = 0; i < 300; i++) told = pick({ kind: i % 6, text: "t" }) + tell({ kind: (i % 6) - 1, text: "t" });
console.log(told);
