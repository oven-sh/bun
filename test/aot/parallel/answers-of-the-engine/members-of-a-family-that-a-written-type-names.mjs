// two makers make the objects of one family, so an interface names a member of each: factories store into fields that no maker fills, readers take members, strangers, frozen objects and objects that have lost a field
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function Made(kind, pos) { this.kind = kind; this.pos = pos; }
const Maker = Made;
function Small(kind, pos) { this.pos = pos; this.kind = kind; }
const SmallMaker = Small;
function base(kind) { return new Maker(kind, 0); }
function small(kind) { return new SmallMaker(kind, 0); }
function sum(left, right) { const node = base(1); node.left = left; node.right = right; return node; }
function product(left, right) { const node = base(2); node.left = left; node.right = right; node.size = 2; return node; }
function leaf(value) { const node = small(3); node.value = value; node.size = 1; return node; }
function name(text) { const node = small(4); node.text = text; return node; }
function leftOf(node) { return node.left; }
function sizeOf(node) { return node.size; }
function rightOf(node) { return node.right; }
function evaluate(node) { switch (node.kind) { case 1: return evaluate(leftOf(node)) + evaluate(node.right); case 2: return evaluate(leftOf(node)) * evaluate(node.right); case 3: return node.value; default: return node.text.length; } }
function tell(f) { try { report(f()); } catch (e) { report(e.name); } }
const tree = sum(product(leaf(3), name("four")), sum(leaf(5), product(leaf(2), leaf(7))));
tell(() => evaluate(tree));
tell(() => Object.keys(tree).join());
tell(() => Object.keys(leftOf(tree)).join());
tell(() => JSON.stringify(tree));
tell(() => sizeOf(leaf(9)) + sizeOf(product(leaf(1), leaf(1))));
tell(() => leftOf(leaf(1)));
tell(() => sizeOf(sum(leaf(1), leaf(2))));
tell(() => sizeOf({ size: "plain" }));
tell(() => leftOf({ left: "plain" }));
tell(() => leftOf(null));
tell(() => rightOf(tree).kind);
tell(() => rightOf(leaf(1)));
tell(() => rightOf(product(leaf(1), leaf(6))).kind);
tell(() => leftOf(Object.freeze(sum(leaf(1), leaf(2)))).kind);
tell(() => { const twice = sum(leaf(1), leaf(2)); twice.left = leaf(8); return evaluate(twice); });
tell(() => { const frozen = Object.freeze(base(1)); "use strict"; frozen.left = leaf(1); return "stored"; });
tell(() => { const gone = product(leaf(2), leaf(3)); delete gone.left; gone.left = leaf(4); return Object.keys(gone).join() + evaluate(gone); });
report("end");
