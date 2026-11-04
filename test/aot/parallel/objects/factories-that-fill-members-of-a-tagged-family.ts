// Two constructor functions make the objects of interfaces that a literal `kind` tells apart, and factories fill them behind a row of calls: through an object of closures, through a function that returns its argument.
// The factories are given objects of their usual maker, of the other maker, of neither, with a key too many, too few, too early, frozen ones, and at the end a setter lies above.
interface Base { kind: number; pos: number; flags: number; }
interface Sum extends Base { kind: 1; left: Any; right: Any; note?: string; }
interface Leaf extends Base { kind: 3; value: number; }
interface Name extends Base { kind: 4; text: string; symbol: unknown; }
type Any = Sum | Leaf | Name;
function Made(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; this.flags = 0; }
const Maker = Made as unknown as new (kind: number, pos: number) => Base;
function Small(this: Base, kind: number, pos: number) { this.pos = pos; this.kind = kind; }
const SmallMaker = Small as unknown as new (kind: number, pos: number) => Base;
interface BaseFactory { createBase(kind: number): Base; createSmall(kind: number): Base; }
let made = 0;
function counted(node: Base) { made++; return node; }
const counting: BaseFactory = { createBase: kind => counted(new Maker(kind, 0)), createSmall: kind => counted(new SmallMaker(kind, 0)) };
const plain: BaseFactory = { createBase: kind => new Maker(kind, -1), createSmall: kind => new SmallMaker(kind, -1) };
function factoriesOver(baseFactory: BaseFactory) {
    function base(kind: number) { return baseFactory.createBase(kind); }
    function declared<T extends Name>(kind: T["kind"]) { const node = baseFactory.createSmall(kind) as T; node.symbol = undefined; return node; }
    function sum(left: Any, right: Any) { const node = base(1) as Sum; node.left = left; node.right = right; node.flags = 1; node.note = undefined; return node; }
    function leaf(value: number) { const node = baseFactory.createSmall(3) as Leaf; node.value = value; return node; }
    function name(text: string) { const node = declared<Name>(4); node.text = text; node.flags |= 2; return node; }
    return { sum, leaf, name };
}
function rightOf(node: Sum) { return node.right; }
function noteOf(node: Sum) { return node.note; }
function valueOf(node: Leaf) { return node.value; }
function textOf(node: Name) { return node.text + String(node.symbol) + node.flags; }
function refill(node: Sum, left: Any, right: Any) { node.left = left; node.right = right; node.note = "again"; return node; }
function evaluate(node: Any): number { switch (node.kind) { case 1: return evaluate(node.left) + evaluate(rightOf(node)); case 3: return valueOf(node); default: return node.text.length; } }
function show(value: object) { let listed = ""; for (const key in value) listed += key + ";"; return Object.keys(value).join() + " " + listed + " " + JSON.stringify(value) + " " + Object.keys({ ...value }).join(); }
function tell(f: () => unknown) { try { console.log(f()); } catch (e) { console.log((e as Error).name); } }
const usual = factoriesOver(counting);
const other = factoriesOver(plain);
for (let round = 0; round < 3; round++) {
    tell(() => show(usual.sum(usual.sum(usual.leaf(3), usual.name("four")), other.leaf(5))));
    tell(() => evaluate(other.sum(other.sum(usual.leaf(3), other.name("four")), other.leaf(5))));
    tell(() => show(usual.leaf(1)) + show(usual.name("n")) + textOf(other.name("m")));
    tell(() => made);
    // The other maker, and neither.
    const swapped = factoriesOver({ createBase: plain.createSmall, createSmall: plain.createBase });
    tell(() => show(swapped.sum(swapped.leaf(1), swapped.name("x"))) + evaluate(swapped.sum(swapped.leaf(1), swapped.name("xy"))));
    tell(() => String(noteOf(swapped.sum(usual.leaf(1), usual.leaf(2)))) + valueOf(swapped.leaf(7)) + textOf(swapped.name("t")));
    const literal = factoriesOver({ createBase: kind => ({ kind, pos: 1, flags: 2 }), createSmall: kind => ({ flags: 9, kind, pos: 1 }) });
    tell(() => show(literal.sum(literal.leaf(1), literal.name("x"))) + evaluate(literal.sum(literal.leaf(1), literal.name("xy"))));
    // A key too early, too many, too few.
    const early = factoriesOver({ createBase: kind => { const node = new Maker(kind, 3) as Sum; node.right = usual.leaf(0); return node; }, createSmall: kind => { const node = new SmallMaker(kind, 3) as any; node.text = "early"; return node; } });
    tell(() => show(early.sum(usual.leaf(1), usual.leaf(2))) + show(early.name("late")) + show(early.leaf(4)));
    const more = factoriesOver({ createBase: kind => { const node = new Maker(kind, 4) as any; node.extra = 1; return node; }, createSmall: kind => { const node = new SmallMaker(kind, 4) as any; node[0] = "zero"; return node; } });
    tell(() => show(more.sum(usual.leaf(1), usual.leaf(2))) + show(more.name("more")) + show(more.leaf(4)));
    const less = factoriesOver({ createBase: kind => { const node = new Maker(kind, 5) as any; delete node.flags; return node; }, createSmall: kind => { const node = new SmallMaker(kind, 5) as any; delete node.pos; return node; } });
    tell(() => show(less.sum(usual.leaf(1), usual.leaf(2))) + show(less.name("less")) + show(less.leaf(4)));
    // What may not be stored on.
    const frozen = factoriesOver({ createBase: kind => Object.freeze(new Maker(kind, 6)), createSmall: kind => Object.preventExtensions(new SmallMaker(kind, 6)) });
    tell(() => show(frozen.sum(usual.leaf(1), usual.leaf(2))));
    tell(() => show(frozen.leaf(1)));
    tell(() => show(frozen.name("f")));
    const fixed = factoriesOver({ createBase: kind => Object.defineProperty(new Maker(kind, 7), "right", { value: "fixed", enumerable: true }), createSmall: kind => Object.defineProperty(new SmallMaker(kind, 7), "value", { get() { return "got"; }, enumerable: false, configurable: true }) });
    tell(() => show(fixed.sum(usual.leaf(1), usual.leaf(2))));
    tell(() => show(fixed.leaf(1)));
    const nothing = factoriesOver({ createBase: () => null as any, createSmall: () => 7 as any });
    tell(() => show(nothing.sum(usual.leaf(1), usual.leaf(2))));
    tell(() => String(nothing.leaf(1)));
    const below = factoriesOver({ createBase: kind => Object.create(usual.sum(usual.leaf(1), usual.leaf(2))), createSmall: kind => new Proxy(new SmallMaker(kind, 8), { set(target, key, value) { (target as any)[key] = [value]; return true; } }) });
    tell(() => show(below.sum(usual.leaf(3), usual.leaf(4))) + show(below.leaf(5)) + show(below.name("p")));
    // Filled a second time, in another order, behind a delete.
    tell(() => show(refill(usual.sum(usual.leaf(1), usual.leaf(2)), usual.leaf(3), usual.leaf(4))));
    tell(() => { const node = usual.sum(usual.leaf(1), usual.leaf(2)); delete (node as any).left; return show(refill(node, usual.leaf(3), usual.leaf(4))); });
    tell(() => show(refill(plain.createBase(1) as Sum, usual.leaf(3), usual.leaf(4))) + show(refill(plain.createSmall(1) as Sum, usual.leaf(3), usual.leaf(4))));
}
let seen = "";
Object.defineProperty(Made.prototype, "right", { set(value) { seen += "right;"; }, get() { return usual.leaf(40); }, configurable: true });
Object.defineProperty(Small.prototype, "value", { set(value) { seen += "value" + value + ";"; }, get() { return 41; }, configurable: true });
tell(() => show(usual.sum(usual.leaf(1), usual.leaf(2))) + seen + evaluate(usual.sum(usual.leaf(1), usual.leaf(2))) + seen);
tell(() => show(other.leaf(6)) + seen + valueOf(other.leaf(7)));
