// Stores at unknown indices into unknown lists of every storage.
const any: any = (globalThis as any)["Obj" + "ect"];
function hide(v: any): any { return any.is(v, hide) ? null : v; }
function kinds(): any[] {
    const cow = [1, 2, 3, 4], frozen = any.freeze([1, 2, 3]), sealed = any.seal([1.5, 2.5]), slow: any[] = []; slow[200000] = 1;
    const holes: any[] = [1, , 3, , 5], doubles = [0.5, 1.5, 2.5, 3.5], doubleHoles: any[] = [0.5, , 2.5], ints = [1, 2, 3].map(x => x + 1), objects: any[] = [{}, "a", null, undefined, 4];
    const grown: any[] = []; for (let i = 0; i < 5; ++i) grown.push(i); const popped = [1.5, 2.5, 3.5]; popped.pop(); const empty: any[] = [], short = [1, 2, 3, 4, 5, 6]; short.length = 2;
    const getter: any[] = [1, 2, 3]; any.defineProperty(getter, 1, { get() { return 77; }, set(v) { (this as any).seen = String(v); }, configurable: true });
    const fixed: any[] = [1, 2, 3]; any.preventExtensions(fixed); const bag: any = { 0: 1, 1: 2.5, a: 3 }, sub: any = new (class extends Array { x = 1 })(); sub.push(1, 2);
    const readOnly: any[] = [1, 2]; any.defineProperty(readOnly, "length", { writable: false });
    return [cow, frozen, sealed, slow, holes, doubles, doubleHoles, ints, objects, grown, popped, empty, short, getter, fixed, bag, sub, readOnly, new Float64Array(4), new Int8Array(4), [[1, 2], [3]], [NaN, 1, -0], [2147483647, -2147483648], [4294967296]];
}
const values: any[] = [0, 7, -1, 2147483647, -2147483648, 0.25, -0, NaN, Infinity, 4294967295, 1e300, "s", "12", null, undefined, true, { valueOf() { return 3; } }, Symbol.iterator, 12n, [1]];
const keys: any[] = [0, 1, 2, 3, 4, 5, 6, 7, 10, 40, 1.5, -1, "1", "length", "x", 4294967295, 2 ** 31, -0, 100];
function store(list: any, key: any, value: any) { list[key] = value; }
function storeInLoop(list: any, key: any, value: any, count: number) { for (let i = 0; i < count; ++i) list[key + i] = value; }
function fill(list: any, from: any, to: any, value: any) { for (let i = from; i < to; ++i) list[i] = value; return list.length; }
function add(list: any, key: any, value: any) { list[key] += value; }
let lines = 0, sum = 0;
function text(v: any): string { if (typeof v === "symbol") return "Y" + String(v); if (typeof v === "bigint") return v + "n"; if (typeof v === "string") return "'" + v; if (any.is(v, -0)) return "-0"; if (v && typeof v === "object") return "{" + any.keys(v).slice(0, 14).map((k: string) => k + ":" + (typeof v[k] === "object" && v[k] ? "o" : text(v[k]))).join() + "}" + String(v.length ?? "") + String(v.seen ?? ""); return String(v); }
function note(s: string) { ++lines; for (let i = 0; i < s.length; ++i) sum = (sum * 31 + s.charCodeAt(i)) | 0; }
for (let round = 0; round < 1; ++round)
    for (let k = 0; k < kinds().length; ++k)
        for (let v = 0; v < values.length; ++v)
            for (let n = 0; n < keys.length; ++n)
                for (let form = 0; form < 4; ++form) {
                    if (form === 1 && (typeof keys[n] !== "number" || keys[n] > 50)) continue;
                    if (form === 2 && n > 8) continue;
                    const list = hide(kinds()[k]); let failed = "";
                    try {
                        if (form === 0) { store(list, keys[n], values[v]); store(list, keys[n], values[(v * 7 + 3) % values.length]); }
                        else if (form === 1) storeInLoop(list, keys[n], values[v], 3);
                        else if (form === 2) failed = "" + fill(list, 0, keys[n], values[v]);
                        else add(list, keys[n], values[v]);
                    } catch (e: any) { failed = e.constructor.name; }
                    note(k + " " + v + " " + n + " " + form + " " + failed + " " + text(list));
                }
console.log(lines, sum);
