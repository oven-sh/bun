declare const console: { log(...values: unknown[]): void };
class Holder { whole: number; part: number; maybe?: number; any: unknown; constructor(w: number, p: number, m: number | undefined, a: unknown) { this.whole = w; this.part = p; if (m !== undefined) this.maybe = m; this.any = a; } }
function ofParameter(x: number): string { return x ? "T" : "F"; }
function ofOptional(x?: number): string { return x ? "T" : "F"; }
function ofNullable(x: number | null | undefined): string { return x ? "T" : "F"; }
function ofField(h: Holder): string { return (h.whole ? "T" : "F") + (h.part ? "T" : "F") + (h.maybe ? "T" : "F") + (h.any ? "T" : "F"); }
function ofNot(x: number): boolean { return !x; }
function ofBoth(x: number, y: number): number { return x && y; }
function ofEither(x: number, y: number): number { return x || y; }
function ofAnything(x: unknown): string { return x ? "T" : "F"; }
function ofUnion(x: number | string): string { return x ? "T" : "F"; }
function ofElement(xs: number[], i: number): string { return xs[i] ? "T" : "F"; }
function inLoop(xs: number[]): number { let n = 0; for (const x of xs) if (x) n++; while (xs[n]) n++; return n; }
function asValue(x: number): boolean { const b = !!x; return b; }
const values = [0, -0, NaN, 1, -1, 0.5, -0.5, 5e-324, -5e-324, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 1e308, 9007199254740993];
const out: string[] = [];
for (const v of values) {
    const h = new Holder(v, v / 3, v, v);
    out.push([ofParameter(v), ofOptional(v), ofNullable(v), ofField(h), ofNot(v), Object.is(ofBoth(v, 7), -0) ? "-0" : ofBoth(v, 7), Object.is(ofEither(v, 7), -0) ? "-0" : ofEither(v, 7), ofAnything(v), ofUnion(v), asValue(v)].join(" "));
}
console.log(out.join("\n"));
console.log(ofOptional(), ofNullable(null), ofNullable(undefined), ofField(new Holder(0, NaN, undefined, NaN)), ofAnything(-0), ofAnything(0 / 0), ofUnion(""), ofUnion("0"));
console.log(values.map((_, i) => ofElement(values, i)).join(""), ofElement(values, 99), ofElement([0.5, 0, NaN], 0), ofElement([0.5, 0, NaN], 2), inLoop(values), inLoop([1, 2, 3]), inLoop([0.5, NaN, 1.5]));
