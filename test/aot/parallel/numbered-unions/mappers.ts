declare const Bun: any;
class Type { flags: number; id: number; symbol: any; constructor(flags: number, id: number) { this.flags = flags; this.id = id; this.symbol = undefined; } }
enum MapKind { Simple, Array, Composite, Merged }
type Mapper = { kind: MapKind.Simple; source: Type; target: Type } | { kind: MapKind.Array; sources: readonly Type[]; targets: readonly Type[] | undefined } | { kind: MapKind.Composite | MapKind.Merged; mapper1: Mapper; mapper2: Mapper };
interface Flow { flags: MapKind; id: number; node: unknown; antecedent: Flow | undefined }
const g: any = globalThis;
function makeUnary(source: Type, target: Type): Mapper { return { kind: MapKind.Simple, source, target }; }
function makeArray(sources: readonly Type[], targets: readonly Type[] | undefined): Mapper { return { kind: MapKind.Array, sources, targets }; }
function makeComposite(kind: MapKind.Composite | MapKind.Merged, mapper1: Mapper, mapper2: Mapper): Mapper { return { kind, mapper1, mapper2 }; }
function makeFlow(flags: MapKind, node: unknown, antecedent: Flow | undefined): Flow { return { flags, id: 0, node, antecedent }; }
function get(type: Type, mapper: Mapper): Type {
    switch (mapper.kind) {
        case MapKind.Simple: return type === mapper.source ? mapper.target : type;
        case MapKind.Array: { const s = mapper.sources, t = mapper.targets; for (let i = 0; i < s.length; i++) if (type === s[i]) return t ? t[i] : type; return type; }
        default: { const t1 = get(type, mapper.mapper1); return t1 !== type && mapper.kind === MapKind.Composite ? t1 : get(t1, mapper.mapper2); }
    }
}
const types: Type[] = []; for (let k = 0; k < 64; k++) types.push(new Type(k, k * 3));
g.api = { makeUnary, makeArray, makeComposite, makeFlow, get, Type, types, extend: (x: any, v: any) => { x.later = v; } };
let sum = 0; const kept: any[] = [];
g.go = (api: any, turns: number) => { for (let k = 0; k < turns; k++) { const u = api.makeUnary(types[k % 64], types[(k + 1) % 64]), a = api.makeArray([types[k % 64], types[(k + 2) % 64]], k % 5 ? [types[3], types[4]] : undefined), c = api.makeComposite(k % 3 ? MapKind.Composite : MapKind.Merged, u, a); sum += api.get(types[k % 64], c).id; let f = api.makeFlow(MapKind.Array, u, undefined); f = api.makeFlow(MapKind.Merged, c, f); f.flags |= 8; f.id = k; sum += f.flags + f.antecedent.flags + (f.antecedent.node.kind | 0); if (k % 64 === 0) kept.push(u, a, c, f); } };
g.go(g.api, 200000); g.api.extend(kept[0], 1); 
const odd: any[] = [undefined, null, 0, -0, 1.5, 2 ** 40, NaN, "", "text", true, types[1], [types[2]], {}, () => types[3], 10n, Symbol.iterator, new Proxy(types[4], {})];
let log = "";
function say(x: any): string { return x === undefined ? "u" : x === null ? "n" : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "string" ? JSON.stringify(x) : typeof x === "symbol" ? "s" : typeof x === "bigint" ? x + "n" : typeof x === "function" ? "f" : typeof x === "boolean" ? String(x) : Array.isArray(x) ? "[" + x.map(say).join() + "]" : "{" + Object.keys(x).map(key => key + ":" + say(x[key])).join() + "}"; }
for (const value of odd) for (const other of odd) {
    const made: any[] = [g.api.makeUnary(value, other), g.api.makeArray(value, other), g.api.makeComposite(value, other, value), g.api.makeFlow(value, other, value)];
    for (const x of made) { log += say(x) + say({ ...x }) + ";"; x.kind = other; x.source = value; x.flags = value; log += say(x) + ";"; x.later = other; delete x.kind; log += say(x) + "\n"; }
    try { log += say(g.api.get(types[0], made[0])); } catch (error: any) { log += error.name; }
}
for (let round = 0; round < 3; round++) { const keep: any[] = []; for (let k = 0; k < 20000; k++) keep.push(makeUnary(types[k % 64], types[(k + 1) % 64]), makeArray([types[k % 64]], undefined)); Bun.gc(true); for (let k = 0; k < keep.length; k += 2) sum += get(types[k / 2 % 64], keep[k]).id + keep[k + 1].sources[0].id; }
let hash = 0; for (let k = 0; k < log.length; k++) hash = (hash * 31 + log.charCodeAt(k)) | 0;
console.log(sum, kept.length, Object.keys(kept[0]).join(), JSON.stringify(kept[3].flags), log.length, hash);
