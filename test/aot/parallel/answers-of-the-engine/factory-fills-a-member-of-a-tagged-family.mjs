// `sum()` stores on what `base()` has from one of the closures under `createBase`: objects of either maker, frozen ones, ones with a key too many, too few or too early come through the factories, and every list of keys is as the language has it
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function Made(kind, pos) { this.kind = kind; this.pos = pos; this.flags = 0; }
const Maker = Made;
function Small(kind, pos) { this.pos = pos; this.kind = kind; }
const SmallMaker = Small;
let made = 0;
function counted(node) { made++; return node; }
const counting = { createBase: (kind) => counted(new Maker(kind, 0)), createSmall: (kind) => counted(new SmallMaker(kind, 0)) };
const plain = { createBase: (kind) => new Maker(kind, -1), createSmall: (kind) => new SmallMaker(kind, -1) };
let baseFactory = counting;
function base(kind) { return baseFactory.createBase(kind); }
function marked(kind) { const node = base(kind); node.mark = undefined; return node; }
function sum(left, right) { const node = base(1); node.left = left; node.right = right; node.flags = 1; node.note = undefined; return node; }
function leaf(value) { const node = baseFactory.createSmall(3); node.value = value; return node; }
function name(text) { const node = baseFactory.createSmall(4); node.text = text; return node; }
function rightOf(node) { return node.right; }
function valueOf(node) { return node.value; }
function evaluate(node) { switch (node.kind) { case 1: return evaluate(node.left) + evaluate(rightOf(node)); case 3: return valueOf(node); default: return node.text.length; } }
function tell(f) { try { report(f()); } catch (e) { report(e.name); } }
const tree = sum(sum(leaf(3), name("four")), leaf(5));
tell(() => evaluate(tree));
tell(() => Object.keys(tree).join());
tell(() => Object.keys(leaf(1)).join());
tell(() => JSON.stringify(tree));
baseFactory = plain;
tell(() => JSON.stringify(sum(leaf(1), name("x"))));
tell(() => made);
tell(() => { const odd = baseFactory.createSmall(1); odd.right = leaf(6); odd.left = leaf(7); return Object.keys(odd).join() + evaluate(odd) + valueOf(rightOf(odd)); });
tell(() => { const odd = baseFactory.createBase(3); odd.value = 8; return Object.keys(odd).join() + evaluate(odd); });
tell(() => { baseFactory = { createBase: (kind) => ({ kind, pos: 1, flags: 2 }), createSmall: (kind) => Object.freeze(new SmallMaker(kind, 2)) }; return Object.keys(sum(tree, tree)).join(); });
tell(() => leaf(9));
tell(() => { baseFactory = { createBase: (kind) => { const early = new Maker(kind, 3); early.right = tree; return early; }, createSmall: plain.createSmall }; return Object.keys(sum(leaf(1), leaf(2))).join(); });
tell(() => { baseFactory = { createBase: (kind) => { const more = new Maker(kind, 4); more.extra = 1; return more; }, createSmall: plain.createSmall }; return Object.keys(sum(leaf(1), leaf(2))).join(); });
tell(() => { baseFactory = { createBase: (kind) => { const less = new Maker(kind, 5); delete less.flags; return less; }, createSmall: plain.createSmall }; return Object.keys(sum(leaf(1), leaf(2))).join(); });
tell(() => Object.keys(marked(1)).join());
report("end");
