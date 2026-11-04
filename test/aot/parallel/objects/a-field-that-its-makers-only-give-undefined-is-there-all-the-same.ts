// `this.exports = undefined` in a constructor gives the object the key and fills nothing. The slot may lie out of line and take no room until something is stored: the key is there all the same, in its place among the keys, and hides what the prototype has under the name.
interface Sym { flags: number; name: string; declarations?: string[]; parent?: Sym; members?: Map<string, Sym>; exports?: Map<string, Sym>; exportSymbol?: Sym; isReferenced?: number; last?: number; }
function Sym(this: Sym, flags: number, name: string) {
    this.flags = flags;
    this.name = name;
    this.declarations = undefined;
    this.parent = undefined;
    this.members = undefined;
    this.exports = undefined;
    this.exportSymbol = undefined;
    this.isReferenced = undefined;
    this.last = undefined;
}
(Sym.prototype as any).exports = "of the prototype";
(Sym.prototype as any).last = "last of the prototype";
const make = (flags: number, name: string): Sym => new (Sym as any)(flags, name);
function withDeclarations(flags: number, name: string, from: Sym) { const made = make(flags, name); made.declarations = from.declarations; made.parent = from; return made; }
function withMore(flags: number, name: string, from: Sym) { const made = withDeclarations(flags, name, from); made.flags |= 64; return made; }

class Holder {
    first = 1;
    left?: Holder = undefined;
    right?: Holder = undefined;
    note?: string;
    last = "z";
    constructor(public id: number) { this.note = undefined; }
}

const lines: string[] = [];
const brief = (v: any): string => v instanceof Map ? "Map(" + v.size + ")" : v && typeof v === "object" ? "{" + (v.name ?? v.id ?? "") + "}" : String(v);
const show = (label: string, o: any) => lines.push(label + " " + JSON.stringify(Object.keys(o)) + " " + JSON.stringify(o, (k, v) => k === "" ? v : brief(v)) + " " + Object.entries(o).map(([k, v]) => k + "=" + brief(v)).join(","));
const root = make(1, "root");
show("fresh", root);
lines.push([root.exports, root.last, "exports" in root, Object.hasOwn(root, "exports"), Object.hasOwn(root, "last"), root.hasOwnProperty("members"), Object.getOwnPropertyDescriptor(root, "exportSymbol")?.enumerable, JSON.stringify(Object.getOwnPropertyDescriptor(root, "isReferenced"))].join("|"));
const all: Sym[] = [];
for (let i = 0; i < 40; i++) {
    const s = i % 3 === 0 ? make(i, "s" + i) : i % 3 === 1 ? withDeclarations(i, "d" + i, root) : withMore(i, "m" + i, root);
    if (i % 10 === 0) s.exports = new Map([["a", root]]);
    if (i % 13 === 0) s.members = new Map();
    if (i % 7 === 0) s.isReferenced = i;
    if (i % 11 === 0) s.last = i;
    if (i % 17 === 0) s.exportSymbol = s;
    if (i % 19 === 0) { s.exports = undefined; s.isReferenced = undefined; }
    all.push(s);
}
let sum = 0;
for (const s of all) sum += (s.exports ? s.exports.size : 0) * 3 + (s.members ? 5 : 0) + (s.isReferenced ?? 100) + (s.last === undefined ? 7 : (s.last as number)) + (s.exportSymbol === s ? 1000 : 0) + Object.keys(s).length;
lines.push("sum " + sum);
show("filled", all[0]); show("one", all[10]); show("other", all[22]);
const gone = all[20]; delete gone.exports; delete gone.members; show("deleted", gone); lines.push(String(gone.exports) + "|" + ("exports" in gone) + "|" + Object.hasOwn(gone, "exports") + "|" + String(gone.members));
gone.exports = new Map(); gone.members = undefined; show("back", gone);
const never = all[3]; delete never.last; lines.push(String(never.last)); never.last = 4; lines.push(String(never.last) + Object.keys(never).join());
const copy = { ...all[7] }; show("spread", copy); show("assigned", Object.assign({}, all[11], { extra: 1 }));
for (const k in all[13]) lines.push("in " + k);
Object.defineProperty(all[14], "exportSymbol", { value: 5, enumerable: false, writable: true, configurable: true }); show("defined", all[14]); lines.push(String(all[14].exportSymbol));
Object.freeze(all[15]); try { "use strict"; (all[15] as any).exports = 1; } catch (e) { lines.push("frozen: " + (e as Error).constructor.name); } lines.push(String(all[15].exports) + Object.isFrozen(all[15]));
Object.seal(all[16]); all[16].members = new Map(); lines.push(String(all[16].members?.size) + Object.isSealed(all[16]));
const h = new Holder(3); show("holder", h); h.right = new Holder(4); h.note = "n"; show("holder filled", h); lines.push(String(h.left) + ("left" in h) + Object.keys(new Holder(5)).join());
const key = ["exp", "orts"].join(""); lines.push(String((all[1] as any)[key]) + String((all[10] as any)[key]?.size)); (all[1] as any)[key] = 9; lines.push(String(all[1].exports));
lines.push(JSON.stringify(structuredClone({ ...all[3], parent: undefined })));
console.log(lines.join("\n"));
