// A `let` in a `switch` case is initialized from the narrowed number and then incremented, decremented and captured.
declare const console: { log(...a: unknown[]): void };
function f(k: number) { switch (k) { case 1: let w = k; return ++w; } }
function g(k: number) { switch (k) { case 1: let w = k; w++; w++; return w * 2; } return 0; }
function h(k: number) { switch (k) { case 5: let w = k; --w; const c = () => w; w--; return c() + w; } return 0; }
function b(k: bigint) { switch (k) { case 1n: let w = k; w++; return w; } return 0n; }
function still(k: number) { switch (k) { case 7: const w = k; return w + 1; } return 0; }
console.log(f(1), g(1), h(5), b(1n) === 2n, still(7));
