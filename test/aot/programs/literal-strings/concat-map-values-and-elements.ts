// A field of a union of string literals joined with what a Map, an array, a generic function or a Promise yields, under `!`, `??`, `||`, `&&`, `?:` and the assignments made of them.
type K = "a" | "b" | "c" | "";
class H {
    kind: K | undefined;
    opt?: K;
    must: K = "c";
    constructor(k?: K) { this.kind = k; }
}
const table = new Map<string, K>([["x", "b"], ["e", ""]]);
const list: K[] = ["c", "a", ""];
function same<T extends string>(t: T): T { return t; }
function first<T>(ts: T[]): T | undefined { return ts[0]; }
function name(k: K | undefined | null): string { return k === "a" ? "A" : k === "b" ? "B" : k === "c" ? "C" : k === "" ? "E" : k == null ? "N" : "?"; }
function fromMap(h: H, key: string): K { return (h.kind ?? table.get(key))!; }
function fromElement(h: H, i: number): K { return (h.kind || list[i])!; }
function chosen(c: boolean, h: H, i: number): K { return (c ? h.kind : list[i])!; }
function both(h: H, key: string, i: number): K { return (table.get(key) ?? list[i] ?? h.must)!; }
function guarded(h: H, key: string): K | undefined { return h.kind && table.get(key); }
function generic(h: H, c: boolean): K { return (c ? same(h.must) : first(list))!; }
function assigned(h: H, key: string, i: number): string {
    let k = h.kind; k ??= table.get(key); let m = h.opt; m ||= list[i]; let n: K | undefined = h.must; n &&= table.get(key);
    h.opt ??= list[i]; h.kind ||= table.get(key);
    return [k, m, n, h.opt, h.kind].map(name).join("");
}
function carried(h: H): string {
    let k: K | undefined = h.kind, trace = "";
    for (const next of list) { trace += name(k); k = trace.length & 1 ? next : h.must; }
    for (const [key, value] of table) { trace += key + name(k); k = value; }
    return trace + name(k);
}
async function awaited(h: H, key: string): Promise<K> { return (h.kind ?? (await Promise.resolve(table.get(key))))!; }
const out: string[] = [];
for (const h of [() => new H(), () => new H("a"), () => new H("")]) {
    out.push(name(fromMap(h(), "x")), name(fromMap(h(), "e")), name(fromElement(h(), 0)), name(fromElement(h(), 1)), name(chosen(false, h(), 2)), name(both(h(), "x", 0)), name(both(h(), "q", 1)), name(both(h(), "q", 9)));
    out.push(name(guarded(h(), "x")), name(guarded(h(), "q")), name(generic(h(), true)), name(generic(h(), false)), assigned(h(), "x", 1), assigned(h(), "q", 0), carried(h()));
}
out.push(name(chosen(true, new H("b"), 0)));
console.log(out.join(" "));
Promise.all([awaited(new H(), "x"), awaited(new H("c"), "x"), awaited(new H(), "e")]).then(all => console.log(all.map(name).join("")));
