const out: string[] = [];
function fractions(): number[] { const list: number[] = []; for (let i = 0; i < 9; i++) list.push(i + 0.5); return list; }
function integers(): number[] { const list: number[] = []; for (let i = 0; i < 9; i++) list.push(i); return list; }
function mixed(): number[] { const list: number[] = []; for (let i = 0; i < 9; i++) list.push(i % 2 ? i : i + 0.25); return list; }
function holed(): number[] { const list = integers(); delete list[4]; return list; }
function hits(make: () => number[], wanted: number) { const list = make(); let n = 0; for (let t = 0; t < 6; t++) if (list.some(x => x === wanted)) n++; return n; }
function sums(make: () => number[]) { const list = make(); let sum = 0; for (let t = 0; t < 6; t++) list.forEach(x => { sum += x; }); return sum; }
function firsts(make: () => number[], least: number) { const list = make(); let sum = 0; for (let t = 0; t < 6; t++) sum += list.find(x => x > least) ?? -1; return sum; }
function hitsInFractions(wanted: number) { const list = fractions(); let n = 0; for (let t = 0; t < 6; t++) if (list.some(x => x === wanted)) n++; return n; }
function sumOfFractions() { const list = fractions(); let sum = 0; for (let t = 0; t < 6; t++) list.forEach(x => { sum += x; }); return sum; }
for (const make of [fractions, integers, mixed, holed]) out.push([hits(make, 4), hits(make, 4.5), hits(make, 4.25), hits(make, 99), sums(make), firsts(make, 3), firsts(make, 50)].join(" "));
out.push([hitsInFractions(4.5), hitsInFractions(4), sumOfFractions()].join(" "));
console.log(out.join("\n"));
