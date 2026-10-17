// An exhaustive switch over a numeric enum falls through when it is handed a number that is no member.
declare const console: { log(...a: unknown[]): void };
enum K { A }
function pick(a: string, k: K): string { switch (k) { case K.A: return a; } }
console.log(pick("x", "ab".length));
