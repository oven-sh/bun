// A function without a written result type returns an `any` on one path and a literal on the other.
declare const console: { log(...a: unknown[]): void };
function make(o: any) { if (o) return o; return { m: () => 1 }; }
console.log(make(0).m === make(0).m);
