// The code behind `assert(false)` is reached when the assertion function does not throw.
declare const console: { log(...a: unknown[]): void };
function assert(c: unknown): asserts c {}
function pick(a: number): number { if (a > 1) return a; assert(false); }
console.log(pick(1));
