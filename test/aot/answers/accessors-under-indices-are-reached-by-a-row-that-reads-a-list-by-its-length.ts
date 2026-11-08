// answers: with-library
// # A row that reads a list by its length reads under indices through the prototypes: the accessors there are reached, though `length` holds a number. Each row has a class of its own, so that none is reached on account of another
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let reads = 0;
const sum = (x: number, y: number) => x + y;
class Pair { sum: number; constructor(x: number, y: number) { this.sum = x + y; } }
class Applied { a: number; b: number; length: number; constructor(a: number, b: number) { this.a = a; this.b = b; this.length = 2; } get 0() { reads++; return this.a; } get 1() { reads++; return this.b; } }
class AppliedByFunction { a: number; b: number; length: number; constructor(a: number, b: number) { this.a = a; this.b = b; this.length = 2; } get 0() { reads++; return this.a; } get 1() { reads++; return this.b; } }
class AppliedToBuiltin { a: number; b: number; length: number; constructor(a: number, b: number) { this.a = a; this.b = b; this.length = 2; } get 0() { reads++; return this.a; } get 1() { reads++; return this.b; } }
class Constructed { a: number; b: number; length: number; constructor(a: number, b: number) { this.a = a; this.b = b; this.length = 2; } get 0() { reads++; return this.a; } get 1() { reads++; return this.b; } }
class Copied { a: number; b: number; length: number; constructor(a: number, b: number) { this.a = a; this.b = b; this.length = 2; } get 0() { reads++; return this.a; } get 1() { reads++; return this.b; } }
class Sliced { a: number; b: number; length: number; constructor(a: number, b: number) { this.a = a; this.b = b; this.length = 2; } get 0() { reads++; return this.a; } get 1() { reads++; return this.b; } }
report(Reflect.apply(sum, null, new Applied(1, 2) as any));
report(sum.apply(null, new AppliedByFunction(3, 4) as any));
report(Math.max.apply(null, new AppliedToBuiltin(5, 6) as any));
report((Reflect.construct(Pair, new Constructed(7, 8) as any) as Pair).sum);
report(Array.from(new Copied(9, 10) as any).join());
report(Array.prototype.slice.call(new Sliced(11, 12)).join());
report(reads);
report("end");
