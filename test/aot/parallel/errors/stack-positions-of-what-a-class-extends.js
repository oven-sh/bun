// Each line: where the frame stands when what a class extends is no constructor, for what Bun's transpiler prints in place of the expression.
function show(f) { try { console.log(f.name, String(f(0))); } catch (error) { console.log(f.name, error.name, String(error.stack).split("\n").slice(1, 2).join("").replace(/.*:(\d+:\d+)\)?$/, "$1")); } }
show(function literal() { const C = class extends 0 {}; return C; });
show(function literalInParentheses() { const C = class extends (0) {}; return C; });
show(function folded() { const C = class extends (0 && show) {}; return C; });
show(function foldedSum() { const C = class extends (1 + 2) {}; return C; });
show(function constant() { const zero = 0; const C = class extends zero {}; return C; });
show(function parameter(zero) { const C = class extends zero {}; return C; });
show(function parameterInParentheses(zero) { const C = class extends (zero) {}; return C; });
show(function member(zero) { const o = { zero }; const C = class extends o.zero {}; return C; });
show(function call(zero) { const C = class extends show.call(null, () => 0) {}; return C; });
show(function declaration(zero) { class C extends (0 && show) {} return C; });
show(function declarationOfAParameter(zero) { class C extends zero {} return C; });
show(function text() { const C = class extends ("a" + "b") {}; return C; });
show(function negative() { const C = class extends (-1) {}; return C; });
show(function negated() { const one = 1; const C = class extends (-one) {}; return C; });
show(function notted() { const one = 1; const C = class extends (!one) {}; return C; });
show(function voided() { const C = class extends (void 0) {}; return C; });
show(function chosen() { const one = 1; const C = class extends (one ? 2 : show) {}; return C; });
show(function chosenName(zero) { const one = 1; const C = class extends (one ? zero : show) {}; return C; });
show(function behindAComma(zero) { const C = class extends (1, zero) {}; return C; });
show(function logical(zero) { const C = class extends (zero || 0) {}; return C; });
show(function typeofText(zero) { const C = class extends (typeof zero) {}; return C; });
show(function bigint() { const C = class extends (1n) {}; return C; });
show(function template() { const C = class extends (`a`) {}; return C; });
show(function nothingAtAll() { const C = class extends (undefined) {}; return C; });
