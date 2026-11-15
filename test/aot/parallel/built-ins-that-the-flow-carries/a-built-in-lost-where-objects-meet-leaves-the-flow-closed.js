// Under: --aot-check=FlowFixpoint: a parameter meets two prototype objects, null, Object.prototype and an instance. Where objects meet they are folded in later, and that fold lost the built-in in another way than every other join: the flow was at rest and one rule still added a mark.
globalThis.unknown = (...all) => all.length;
class Leaf { constructor() { this.a = 1; } }
class Twig extends Leaf { constructor() { super(); this.b = 2; } }
function deed(above) {}
console.log(unknown(deed(Leaf.prototype), deed(Twig.prototype), deed(null), deed(Object.prototype)));
console.log(unknown(new Leaf(), new Twig(), deed(new Twig())));
