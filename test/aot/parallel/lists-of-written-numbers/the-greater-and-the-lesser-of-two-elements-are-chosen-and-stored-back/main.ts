declare const process: { argv: string[] };
const rounds = +process.argv[2]! || 40;
const L = [2.5, 1, 0.75, 3, 1.25, 2, 0.5, 4, 3.5, 6, 5.25, 7, 8.5, 9, 10.75, 11];
function chosen(list: number[]): void { for (let i = 0; i + 1 < list.length; i += 2) { const a = list[i]!, b = list[i + 1]!; const low = a < b ? a : b, high = a < b ? b : a; list[i] = high; list[i + 1] = low; } }
for (let r = 0; r < rounds; r++) chosen(L);
console.log("SAID", L.join());
export {};
