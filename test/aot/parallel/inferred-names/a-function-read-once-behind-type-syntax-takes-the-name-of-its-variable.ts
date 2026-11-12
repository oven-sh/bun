// Prints the names of functions, arrows and classes that a `let` or `const` names through type syntax and that are read once: each has the name of its variable.
type Run = () => void;
const row = (label: string, run: () => { name: string }) => console.log(label + ":", JSON.stringify(run().name));

row("an assertion", () => { const q = (() => {}) as Run; return q; });
row("an assertion around a function", () => { const q = function () {} as Run; return q; });
row("an annotation", () => { const q: Run = () => {}; return q; });
row("satisfies", () => { const q = (() => {}) satisfies Run; return q; });
row("a non-null assertion", () => { const q = (() => {})!; return q; });
row("an assertion in angle brackets", () => { const q = <Run>(() => {}); return q; });
row("an assertion in the return", () => { const q = () => {}; return q as Run; });
row("an assertion in a second variable", () => { const a = () => {}; const b = a as Run; return b; });
row("an assertion around a class", () => { const Q = class {} as { name: string }; return Q; });
row("type parameters", () => { const q = <T,>(x: T) => x; return q; });
