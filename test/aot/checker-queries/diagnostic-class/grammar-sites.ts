// A grammar error is an EarlyError where JavaScript rejects the text too. A TypeScript-only rule is TypeScriptGrammar, and a type error is Semantic.
break;
again: { again: {} }
function rest(...a: number[], b: number) {}
class Getter { get a(x: number) { return x; } }
const missing;
let let = 1;
({ a = 1 });
function* g(a = yield) {}
1 = 2;
({ p: 1, p: 2 });
function optional(a?: number, b: number) {}
const n: number = "x";
({ __proto__: null, "__proto__": null });
