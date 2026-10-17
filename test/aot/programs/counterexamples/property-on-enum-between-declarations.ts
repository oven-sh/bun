// A property stored on an enum object between two declarations of the enum is still there afterwards.
declare const console: { log(...a: unknown[]): void };
enum E { A }
(E as any).m = 7;
enum E { B = 1 }
console.log((E as any).m);
