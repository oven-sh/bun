// A number that is no integer by its type, compared with any value.
function show(v: any): string { return typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "{" + Object.keys(v).join() + "}" : typeof v === "symbol" ? "symbol" : String(v); }
function row(a: any): string { let s = a.length + ":"; let h = 0; for (let i = 0; i < a.length; i++) { const t = i in a ? show(a[i]) : "hole"; if (i < 3 || i > a.length - 4) s += t + ","; for (let k = 0; k < t.length; k++) h = (h * 31 + t.charCodeAt(k)) | 0; } return s + h; }
function attempt(f: () => any): string { try { return show(f()); } catch (e: any) { return "throws " + e.name; } }
const out: string[] = [];
function note(...parts: any[]): void { out.push(parts.map(p => typeof p === "string" ? p : show(p)).join(" ")); }
let calls = 0; let sum = 0;
function left0(x: number, y: any): boolean { return x * 1.5 < y; }
function right0(x: number, y: any): boolean { return y < x / 3; }
function branch0(x: number, y: any): number { if (x + 0.25 < y) return 1; return 2; }
function loop0(x: number, ys: { v: any }[]): string { let s = ""; let t = x * 0.5; for (const o of ys) { if (t < o.v) { s += "1"; t += 0.25; } else { s += "0"; t -= 0.5; } if (o.v < t) s += "x"; } return s; }
function tree0(x: number, o: { v: number; l: any }): number { let d = 0; for (;;) { if (x < o.v) { d++; if (o.l === null) return d; o = o.l; } else return -d; } }
function left1(x: number, y: any): boolean { return x * 1.5 <= y; }
function right1(x: number, y: any): boolean { return y <= x / 3; }
function branch1(x: number, y: any): number { if (x + 0.25 <= y) return 1; return 2; }
function loop1(x: number, ys: { v: any }[]): string { let s = ""; let t = x * 0.5; for (const o of ys) { if (t <= o.v) { s += "1"; t += 0.25; } else { s += "0"; t -= 0.5; } if (o.v <= t) s += "x"; } return s; }
function tree1(x: number, o: { v: number; l: any }): number { let d = 0; for (;;) { if (x <= o.v) { d++; if (o.l === null) return d; o = o.l; } else return -d; } }
function left2(x: number, y: any): boolean { return x * 1.5 > y; }
function right2(x: number, y: any): boolean { return y > x / 3; }
function branch2(x: number, y: any): number { if (x + 0.25 > y) return 1; return 2; }
function loop2(x: number, ys: { v: any }[]): string { let s = ""; let t = x * 0.5; for (const o of ys) { if (t > o.v) { s += "1"; t += 0.25; } else { s += "0"; t -= 0.5; } if (o.v > t) s += "x"; } return s; }
function tree2(x: number, o: { v: number; l: any }): number { let d = 0; for (;;) { if (x > o.v) { d++; if (o.l === null) return d; o = o.l; } else return -d; } }
function left3(x: number, y: any): boolean { return x * 1.5 >= y; }
function right3(x: number, y: any): boolean { return y >= x / 3; }
function branch3(x: number, y: any): number { if (x + 0.25 >= y) return 1; return 2; }
function loop3(x: number, ys: { v: any }[]): string { let s = ""; let t = x * 0.5; for (const o of ys) { if (t >= o.v) { s += "1"; t += 0.25; } else { s += "0"; t -= 0.5; } if (o.v >= t) s += "x"; } return s; }
function tree3(x: number, o: { v: number; l: any }): number { let d = 0; for (;;) { if (x >= o.v) { d++; if (o.l === null) return d; o = o.l; } else return -d; } }
const others: any[] = [1, 2147483647, -2147483648, 2147483648, 0.5, -0, NaN, Infinity, "s", undefined, null, true, { a: 1 }, 7n, 9007199254740992, "5", "-0.5", "", " 12 ", "0x10", [], [3], new Date(5), { valueOf() { calls++; return 1.5; } }, { toString() { calls++; return "2"; } }, { valueOf() { throw new RangeError("no"); } }, Symbol("s"), () => 1, -1.5, 3, -2147483649, 4294967296, 1e-320];
for (const x of [0.5, -0, 3, 2147483648.5, NaN, -Infinity, 1.5, -1.5, 1e-320, 5]) for (const y of others) {
  note(show(x), attempt(() => show(y)), attempt(() => left0(x, y)), attempt(() => right0(x, y)), attempt(() => branch0(x, y)), attempt(() => loop0(x, [{ v: 1 }, { v: y }, { v: 2.5 }, { v: y }, { v: -3 }])), attempt(() => tree0(x, { v: 2, l: { v: y, l: { v: 1, l: null } } })), show(calls));
  note(show(x), attempt(() => show(y)), attempt(() => left1(x, y)), attempt(() => right1(x, y)), attempt(() => branch1(x, y)), attempt(() => loop1(x, [{ v: 1 }, { v: y }, { v: 2.5 }, { v: y }, { v: -3 }])), attempt(() => tree1(x, { v: 2, l: { v: y, l: { v: 1, l: null } } })), show(calls));
  note(show(x), attempt(() => show(y)), attempt(() => left2(x, y)), attempt(() => right2(x, y)), attempt(() => branch2(x, y)), attempt(() => loop2(x, [{ v: 1 }, { v: y }, { v: 2.5 }, { v: y }, { v: -3 }])), attempt(() => tree2(x, { v: 2, l: { v: y, l: { v: 1, l: null } } })), show(calls));
  note(show(x), attempt(() => show(y)), attempt(() => left3(x, y)), attempt(() => right3(x, y)), attempt(() => branch3(x, y)), attempt(() => loop3(x, [{ v: 1 }, { v: y }, { v: 2.5 }, { v: y }, { v: -3 }])), attempt(() => tree3(x, { v: 2, l: { v: y, l: { v: 1, l: null } } })), show(calls));
}
console.log(out.join("\n"));
