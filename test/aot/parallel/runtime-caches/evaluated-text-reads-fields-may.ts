// Text evaluated at run time reads, asks for and lists fields whose type admits undefined, on objects where the field holds a value, holds undefined, was deleted, was never made, or is answered from above.
class Row { id: number; count: number | undefined; ratio?: number; label: string | undefined; on: boolean | undefined; list: number[] | undefined; inner?: { a: number };
    constructor(i: number, full: boolean) { this.id = i; this.count = full ? i : undefined; if (full) this.ratio = i + 0.5; this.label = full ? "l" + i : undefined; this.on = full ? true : undefined; this.list = full ? [i] : undefined; if (full) this.inner = { a: i }; } }
class Below extends Row { extra: number | undefined = undefined; }
const names = ["id", "count", "ratio", "label", "on", "list", "inner", "extra", "missing"];
const readers = names.map(n => new Function("o", `return o.${n};`));
const askers = names.map(n => new Function("o", `return "${n}" in o;`));
const owners = names.map(n => new Function("o", `return Object.hasOwn(o, "${n}");`));
const byKey = new Function("o", "k", "return o[k];");
const lister = new Function("o", "const k = []; for (const n in o) k.push(n); return k.join('+');");
const text = (v: unknown) => v === undefined ? "undefined" : JSON.stringify(v);
function look(title: string, o: object) {
    for (let turn = 0; turn < 3; turn++) console.log(title, turn, names.map((n, i) => n + "=" + text(readers[i](o)) + "/" + text(byKey(o, n)) + "/" + askers[i](o) + "/" + owners[i](o) + "/" + text((o as any)[n])).join(" "), lister(o), Object.keys(o).join("+"), JSON.stringify(o));
}
const scenes: [string, (o: any) => void][] = [
    ["as made", () => {}],
    ["stored undefined", o => { o.count = undefined; o.ratio = undefined; o.label = undefined; o.on = undefined; o.list = undefined; o.inner = undefined; }],
    ["stored values", o => { o.count = 7; o.ratio = 7.5; o.label = "seven"; o.on = false; o.list = [7]; o.inner = { a: 7 }; }],
    ["deleted", o => { delete o.count; delete o.ratio; delete o.label; delete o.on; delete o.list; delete o.inner; }],
    ["deleted and stored undefined", o => { delete o.count; delete o.label; o.count = undefined; o.label = undefined; }],
    ["other types", o => { o.count = "text"; o.ratio = null; o.label = 5; o.on = {}; o.list = "no list"; }],
    ["getter", o => { Object.defineProperty(o, "count", { get() { return "got"; }, configurable: true, enumerable: true }); }],
    ["hidden", o => { Object.defineProperty(o, "count", { enumerable: false }); Object.defineProperty(o, "label", { value: undefined, enumerable: false }); }],
    ["frozen", o => { Object.freeze(o); }],
    ["extra names", o => { o.missing = undefined; o.more = 1; }],
];
const above: [string, () => void, () => void][] = [
    ["nothing above", () => {}, () => {}],
    ["values above", () => { for (const n of names) (Row.prototype as any)[n] = "above " + n; }, () => { for (const n of names) delete (Row.prototype as any)[n]; }],
    ["getters above", () => { for (const n of names) Object.defineProperty(Row.prototype, n, { get() { return "getter " + n; }, set(v) { Object.defineProperty(this, n, { value: v, writable: true, enumerable: true, configurable: true }); }, configurable: true }); }, () => { for (const n of names) delete (Row.prototype as any)[n]; }],
    ["undefined above", () => { for (const n of names) (Row.prototype as any)[n] = undefined; }, () => { for (const n of names) delete (Row.prototype as any)[n]; }],
];
for (const order of ["change first", "look first"]) for (const [where, put, take] of above) for (const [what, change] of scenes) for (const make of [() => new Row(1, true), () => new Row(2, false), () => new Below(3, false), () => new Below(4, true)]) {
    const o = make();
    if (order === "look first") look("before", o);
    change(o); look(order + " | nothing yet | " + what, o);
    put(); look(order + " | " + where + " | " + what, o);
    const later = make(); change(later); look(order + " | " + where + " | made later | " + what, later);
    take(); look(order + " | taken away | " + what, o);
}
