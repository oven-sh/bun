// Static fields laid behind a class that gets out of sight hold symbols and booleans, until somebody stores something else through a value that nobody knows.
const out = [];
const show = v => typeof v === "symbol" ? String(v) : typeof v === "object" && v ? "object" : String(v);
function make(which) {
    class Kind {
        constructor(kind) { this.kind = kind; }
        get isLeaf() { return this.kind == Kind.Leaf; }
        get isNode() { return this.kind === Kind.Node; }
        static code(kind) {
            switch (kind) {
            case Kind.Leaf: return 1;
            case Kind.Node: return 2;
            case Kind.checked: return 3;
            case Kind.nothing: return 4;
            default: return Kind.checked ? 5 : 6;
            }
        }
    }
    return Kind;
}
class Kind {
    constructor(kind) { this.kind = kind; }
    get isLeaf() { return this.kind == Kind.Leaf; }
    get isNode() { return this.kind === Kind.Node; }
    get isOther() { return this.kind != Kind.Leaf && this.kind !== Kind.Node; }
    static code(kind) {
        switch (kind) {
        case Kind.Leaf: return 1;
        case Kind.Node: return 2;
        case Kind.checked: return 3;
        case Kind.nothing: return 4;
        default: return Kind.checked ? 5 : 6;
        }
    }
    static early() { try { return [Kind.Leaf === undefined, Kind.Node == null, !Kind.checked, Kind.code(undefined)].join(); } catch (e) { return e.constructor.name; } }
}
class Heir extends Kind { static isLeaf(kind) { return kind === Heir.Leaf; } static late(kind) { return kind === Heir.own; } }
out.push(Kind.early());
const leaf = Symbol("Leaf"), node = Symbol("Node");
Kind.Leaf = leaf;
out.push(Kind.early());
Kind.Node = node;
Kind.checked = false;
Kind.nothing = undefined;
Heir.own = null;
out.push(Kind.early());
const registry = new Map([["Kind", Kind], ["Heir", Heir]]);
const unknown = name => registry.get(name);
const values = [leaf, node, false, undefined, null, 0, NaN, "Leaf", 7, { valueOf() { return 7; } }, { [Symbol.toPrimitive]() { return leaf; } }, 3n, "7"];
function look(when) {
    const row = [];
    for (const v of values) {
        let k;
        try { k = new Kind(v); row.push([Kind.code(v), k.isLeaf, k.isNode, k.isOther, Heir.isLeaf(v), Heir.late(v)].map(Number).join("")); } catch (e) { row.push(e.constructor.name); }
    }
    out.push(when + ": " + row.join(" ") + " | " + ["Leaf", "Node", "checked", "nothing"].map(n => show(unknown("Kind")[n])).join() + " | " + Object.keys(Kind).join() + " | " + [Kind.Leaf === Kind.Leaf, Kind.checked ? "t" : "f", !Kind.nothing].join());
}
for (let i = 0; i < 3; i++) look("first " + i);
const K = unknown("Kind"), H = unknown("Heir");
K.Node = Symbol.for("other"); look("another symbol");
K.Node = node; look("back");
K.checked = true; look("true");
K.checked = undefined; look("undefined into a boolean");
K.checked = false;
H.own = leaf; look("a symbol into null");
H.Leaf = node; look("the heir's own");
delete H.Leaf; look("the heir's own is gone");
K.nothing = 7; look("a number");
K.Leaf = "Leaf"; look("a string");
K.Leaf = values[9]; look("an object");
K.Leaf = leaf; look("the symbol again");
Object.defineProperty(K, "Node", { get() { return node; }, configurable: true, enumerable: true }); look("a getter");
delete K.checked; look("deleted");
K.checked = true; look("there again");
Reflect.set(K, "checked", 0); look("by Reflect.set");
Object.assign(K, { nothing: null, Leaf: 7 }); look("by assign");
Object.freeze(K); try { K.Leaf = leaf; } catch (e) { out.push(e.constructor.name); } look("frozen");
for (const how of [k => { k.Leaf = 7; }, k => { k.Leaf = "7"; }, k => Object.defineProperty(k, "Leaf", { value: 3n }), k => { delete k.Leaf; }, k => Object.assign(k, { Leaf: {} }), k => { k.checked = "yes"; }, k => { k.Leaf = undefined; }, k => { k.checked = null; }]) {
    const M = make();
    M.Leaf = leaf; M.Node = node; M.checked = false;
    const before = values.map(v => [M.code(v), +new M(v).isLeaf, +new M(v).isNode].join("")).join(" ");
    how([M][0]);
    out.push(before + " > " + values.map(v => { try { return [M.code(v), +new M(v).isLeaf, +new M(v).isNode].join(""); } catch (e) { return e.constructor.name; } }).join(" "));
}
console.log(out.join("\n"));
