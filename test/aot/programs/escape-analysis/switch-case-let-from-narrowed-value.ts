// A `let` declared in a `switch` case and initialized from a narrowed enum, number or union value is then modified.
declare const console: { log(...a: unknown[]): void };
function t(f: () => unknown): unknown { try { return f(); } catch (e) { return (e as Error).name; } }
enum E { A, B, C }
function anEnum(k: E) { switch (k) { case E.A: let e = k; e++; return e; } return -1; }
function aLoop(k: number) { switch (k) { case 2: let s = 0; for (let i = k; i < 5; i++) s += i; return s; } return -1; }
function aPattern(o: { n: 1 }) { let { n } = o; n++; return n; }
function anArrayPattern(o: [1]) { let [n] = o; n++; return n; }
function aDefault(k: number) { switch (k) { case 3: return ((w = k) => ++w)(); } return -1; }
function aVar(k: number) { switch (k) { case 4: var w = k; w--; return w; } return -1; }
function fromAProperty(o: { readonly n: 7 }) { let w = o.n; w++; return w; }
function compound(k: number) { switch (k) { case 1: let w: number = k; w += 1; w *= 3; return w; } return -1; }
console.log(t(() => anEnum(E.A)), t(() => aLoop(2)), t(() => aPattern({ n: 1 })), t(() => anArrayPattern([1])), t(() => aDefault(3)), t(() => aVar(4)), t(() => fromAProperty({ n: 7 })), t(() => compound(1)));
