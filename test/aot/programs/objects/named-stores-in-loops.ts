declare const console: { log(...values: unknown[]): void };
type Open = { [name: string]: unknown };
function show(v: unknown): string { return typeof v === "object" && v !== null ? JSON.stringify(v) : typeof v + ":" + (Object.is(v, -0) ? "-0" : String(v)); }
function garbage(n: number): number { let t = 0; for (let i = 0; i < n; i++) { const g: Open = { a: [i, i + 0.5], b: "g" + i }; t += (g.b as string).length; } return t; }
function wholes(o: Open, n: number): void { let w = n * 1000003; for (let i = 0; i < n; i++) { w += i; o.count = w; o.small = i; } }
function halves(o: Open, n: number, v: number): void { for (let i = 0; i < n; i++) { o.half = v + i * 0.5; o.ratio = i / 3; } }
function flags(o: Open, n: number): void { for (let i = 0; i < n; i++) { o.odd = (i & 1) === 1; o.none = undefined; o.nil = null; } }
function maybe(o: Open, a: number[], n: number): void { for (let i = 0; i < n; i++) o.element = a[i]; }
function texts(o: Open, n: number): void { for (let i = 0; i < n; i++) { o.text = "t" + i; o.count = i; garbage(3); } }
function cells(o: Open, n: number): void { for (let i = 0; i < n; i++) { o.cell = { at: i, list: [i, "x" + i] }; o.half = i + 0.5; garbage(3); } }
function either(o: Open, n: number): void { for (let i = 0; i < n; i++) { const v: number | string = i % 3 ? i * 1.5 : "s" + i; o.either = v; garbage(2); } }
function eitherCell(o: Open, n: number): void { for (let i = 0; i < n; i++) { const v: number | { at: number } = i & 1 ? { at: i } : i; o.other = v; garbage(2); } }
function anything(o: Open, values: unknown[]): void { for (let i = 0; i < values.length; i++) { o.any = values[i]; garbage(1); } }
class Row { [name: string]: unknown; constructor(n: number) { for (let i = 0; i < n; i++) { this.total = i * 2.5; this.label = "r" + i; this.index = i; } } }
const old: Open[] = [];
for (let i = 0; i < 40; i++) old.push({ count: 0, small: 0, half: 0, ratio: 0, odd: false, none: 1, nil: 1, element: 0, text: "", cell: null, either: 0, other: 0, any: 0 });
garbage(20000);
for (let turn = 0; turn < 3; turn++) {
    for (let k = 0; k < old.length; k++) {
        const o = old[k];
        wholes(o, 5 + k); halves(o, 4 + k, turn); flags(o, 3 + (k & 3)); maybe(o, [1.5, 2, 3.25], 2 + (k % 3)); texts(o, 6); cells(o, 6); either(o, 5 + (k % 4)); eitherCell(o, 4 + (k & 1)); anything(o, [1, "a" + k, { k }, 2.5, null, [k]].slice(0, 1 + (k % 6)));
    }
    garbage(30000);
    for (let k = 0; k < old.length; k += 7)
        console.log(turn + " " + k + ": " + Object.keys(old[k]).map(name => name + "=" + show(old[k][name])).join(" "));
    const row = new Row(4 + turn);
    garbage(5000);
    console.log(Object.keys(row).map(name => name + "=" + show(row[name])).join(" "));
}
