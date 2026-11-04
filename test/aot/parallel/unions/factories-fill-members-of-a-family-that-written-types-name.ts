const report = (value: unknown) => console.log(value);
interface Base { kind: number; pos: number; }
interface Sum extends Base { kind: 1; left: Any; right: Any; }
interface Product extends Base { kind: 2; left: Any; right: Any; size: number; }
interface Leaf extends Base { kind: 3; value: number; size: number; }
interface Name extends Base { kind: 4; text: string; }
type Any = Sum | Product | Leaf | Name;
type Binary = Sum | Product;
type Sized = Product | Leaf;
function Made(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Maker = Made as unknown as new (kind: number, pos: number) => Base;
function Small(this: Base, kind: number, pos: number) { this.pos = pos; this.kind = kind; }
const SmallMaker = Small as unknown as new (kind: number, pos: number) => Base;
function base(kind: number) { return new Maker(kind, 0); }
function small(kind: number) { return new SmallMaker(kind, 0); }
function sum(left: Any, right: Any) { const node = base(1) as Sum; node.left = left; node.right = right; return node; }
function product(left: Any, right: Any) { const node = base(2) as Product; node.left = left; node.right = right; node.size = 2; return node; }
function leaf(value: number) { const node = small(3) as Leaf; node.value = value; node.size = 1; return node; }
function name(text: string) { const node = small(4) as Name; node.text = text; return node; }
function leftOf(node: Binary) { return node.left; }
function sizeOf(node: Sized) { return node.size; }
function rightOf(node: Sum) { return node.right; }
function evaluate(node: Any): number {
    switch (node.kind) {
        case 1: return evaluate(leftOf(node)) + evaluate(node.right);
        case 2: return evaluate(leftOf(node)) * evaluate(node.right);
        case 3: return node.value;
        default: return node.text.length;
    }
}
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const tree = sum(product(leaf(3), name("four")), sum(leaf(5), product(leaf(2), leaf(7))));
tell(() => evaluate(tree));
tell(() => Object.keys(tree).join());
tell(() => Object.keys(leftOf(tree)).join());
tell(() => JSON.stringify(tree));
tell(() => sizeOf(leaf(9)) + sizeOf(product(leaf(1), leaf(1))));
tell(() => leftOf(leaf(1) as any));
tell(() => sizeOf(sum(leaf(1), leaf(2)) as any));
tell(() => sizeOf({ size: "plain" } as any));
tell(() => leftOf({ left: "plain" } as any));
tell(() => leftOf(null as any));
tell(() => rightOf(tree).kind);
tell(() => rightOf(leaf(1) as any));
tell(() => rightOf(product(leaf(1), leaf(6)) as any).kind);
tell(() => leftOf(Object.freeze(sum(leaf(1), leaf(2)))).kind);
tell(() => { const twice = sum(leaf(1), leaf(2)); twice.left = leaf(8); return evaluate(twice); });
tell(() => { const frozen = Object.freeze(base(1)) as Sum; "use strict"; frozen.left = leaf(1); return "stored"; });
tell(() => { const gone = product(leaf(2), leaf(3)); delete (gone as any).left; gone.left = leaf(4); return Object.keys(gone).join() + evaluate(gone); });
report("end");
