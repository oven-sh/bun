// Elements of a `number[]` read where any value is taken: as text, into `unknown`, into a Map, as an argument. Numbers, holes and reads past the end give what plain Bun gives. A string that got into the array through `unknown[]` throws a TypeError where the element is read.
declare const console: { log(...values: unknown[]): void };
function show(v: unknown): string { return typeof v + ":" + (Object.is(v, -0) ? "-0" : String(v)); }
const given: number[] = [0, -0, 1, -1, 42, 2147483647, -2147483648, 2147483648, 4294967296, 0.5, -2.5, 1e21, 5e-324, Infinity, -Infinity, NaN];
function asStrings(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += String(a[i]) + "|"; return s; }
function asTemplates(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += `${a[i]};`; return s; }
function kept(a: number[]): unknown[] { const out: unknown[] = []; for (let i = 0; i < a.length + 1; i++) out.push(a[i]); return out; }
function keptOf(a: number[]): unknown[] { const out: unknown[] = []; for (const x of a) out.push(x); return out; }
function stored(a: number[]): { [name: string]: unknown } { const o: { [name: string]: unknown } = {}; for (let i = 0; i < a.length; i++) o["k" + i] = a[i]; return o; }
function kinds(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) { const v: unknown = a[i]; s += typeof v === "number" ? "n" : typeof v === "undefined" ? "u" : typeof v === "string" ? "s" : "?"; } return s; }
function same(a: number[], v: unknown): number { let n = 0; for (let i = 0; i < a.length; i++) { const x: unknown = a[i]; if (x === v) n++; } return n; }
function values(a: number[]): Map<number, unknown> { const m = new Map<number, unknown>(); for (let i = 0; i < a.length; i++) m.set(i, a[i]); return m; }
function handed(a: number[], f: (v: unknown) => string): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += f(a[i]) + " "; return s; }
function whileStoring(a: number[]): string { let s = ""; for (let i = 0; i < a.length; i++) { s += String(a[i]) + ","; a[i] = i + 0.5; s += String(a[i]) + ";"; } return s; }
function whileBecomingValues(a: number[]): string { let s = ""; for (let i = 0; i < a.length; i++) { s += String(a[i]) + ","; if (i === 1) (a as unknown[])[3] = "text"; } return s; }
function sumLong(a: number[]): number {
    let t = 0;
    for (let i = 0; i < a.length; i++) t += a[i];
    for (let i = 0; i < a.length; i++) t += a[i] * 2;
    for (let i = 0; i < a.length; i++) if (a[i] > 3) t += 1;
    for (let i = 0; i < a.length; i++) t += a[i] * a[i];
    for (let i = 0; i < a.length; i++) t -= a[i] * a[i];
    for (let i = 0; i < a.length; i++) if (a[i] > 3) t -= 1;
    for (let i = 0; i < a.length; i++) t -= a[i] * 2;
    for (let i = 1; i < a.length; i++) t += a[i] - a[i - 1];
    for (let i = 1; i < a.length; i++) t -= a[i] - a[i - 1];
    return t;
}
function stringsAroundCall(a: number[]): string { let s = 0, t = 0; for (let k = 0; k < 3; k++) { s += String(a[k]).length; if (k === 1) t += sumLong(a); s += String(a[k + 1]).length * 10; } return s + " " + t; }
function kindsAroundCall(a: number[]): string { let s = 0, t = 0; for (let k = 0; k < 4; k++) { const v: unknown = a[k]; if (typeof v === "number") s += 1; if (k === 0) t += sumLong(a); const w: unknown = a[k]; if (typeof w === "number") s += 10; if (v === w) s += 100; } return s + " " + t; }
function sameAroundCall(a: number[], v: unknown): string { let n = 0, t = 0; for (let k = 0; k < a.length; k++) { const x: unknown = a[k]; if (x === v) n++; if (k === 1) t += sumLong(a); } return n + " " + t; }
function callAlone(a: number[]): number { return sumLong(a); }
const makers: [string, () => number[]][] = [
    ["given", () => given.slice()], ["born", () => [1, 2.5, 3]], ["parsed", () => JSON.parse("[1,2,3,2147483647,-2147483648,0]") as number[]], ["parsed mixed", () => JSON.parse("[1,2.5,-0,1e3]") as number[]],
    ["holed doubles", () => { const a = [1.5, 2.5, 3.5, 4.5]; delete (a as unknown[])[1]; return a; }], ["holed int32s", () => { const a = JSON.parse("[1,2,3,4]") as number[]; delete (a as unknown[])[2]; return a; }],
    ["values", () => { const a = JSON.parse("[1,2.5,3,\"x\"]") as unknown[]; a.pop(); return a as number[]; }], ["none", () => []], ["holes", () => new Array<number>(3)], ["frozen", () => Object.freeze([1.5, 2]) as number[]],
    ["far", () => { const a = [1.5, 2]; a[70000] = 3; a.length = 5; return a; }],
];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of makers) {
        console.log(name + ": " + asStrings(make()) + " # " + asTemplates(make()) + " # " + kept(make()).map(show).join() + " # " + keptOf(make()).map(show).join() + " # " + JSON.stringify(stored(make())) + " # " + kinds(make()) + " " + same(make(), 1) + same(make(), 2.5) + same(make(), undefined) + same(make(), NaN) + same(make(), 0));
        console.log("  " + stringsAroundCall(make()) + " # " + kindsAroundCall(make()) + " # " + sameAroundCall(make(), 1) + " # " + sameAroundCall(make(), 2) + " # " + callAlone(make()));
        let late: string;
        try { late = whileStoring(make()); } catch (e) { late = e instanceof TypeError ? "TypeError" : "threw"; }
        console.log("  " + [...values(make())].map(e => e[0] + ">" + show(e[1])).join() + " # " + handed(make(), show) + " # " + late);
    }
    let said: string;
    try { said = whileBecomingValues([1.5, 2.5, 3.5, 4.5, 5.5]); } catch (e) { said = e instanceof TypeError ? "TypeError" : "threw"; }
    console.log(said);
}
