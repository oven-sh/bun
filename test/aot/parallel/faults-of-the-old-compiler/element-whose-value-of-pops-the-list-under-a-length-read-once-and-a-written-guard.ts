// A loop goes by a length read once in front of it; the valueOf of an element pops the list, and each turn asks the present length first.
let G: any = null;
const V: any = { valueOf() { G.pop(); return 1; } };
function k(a: any) { G = a; const n = a.length; let s = 777123, u = 0; for (let i = 0; i < n; i++) { if (i >= a.length) continue; const v = a[i]; if (v === undefined) u++; else s += v * 2; } return s + ":" + u; }
let out = "";
for (let r = 0; r < Number(process.argv[2] ?? 12); r++) { const a: any = [1.5, r % 5 === 4 ? V : 3.5, 4.5]; out += " " + k(a) + "/" + a.length; }
console.log(out);
export {};
