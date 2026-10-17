// Enum members read with a dot, a literal key, a key held in a `const` and an optional chain, on ordinary, declared and merged enums.
declare const console: { log(...a: unknown[]): void };
declare enum D { A = 1 }
(globalThis as any).D = { A: 2 };
console.log("a declared enum, by a key: " + D["A"] + ", by a dot: " + D.A + ", by a chain: " + D?.A + ", by a chained key: " + D?.["A"]);
enum E { A = 1 }
declare enum E { B = 5 }
console.log("the ambient half of a merged enum: " + E.B + " " + E["B"] + "; the real half: " + E.A + " " + E["A"]);
enum F { A = 3 }
const k = "A";
console.log("a key that is a const: " + F[k] + "; a template: " + F[`A`] + "; the reverse: " + F[3] + " " + F[F.A]);
const o: Record<string, unknown> = F;
o.A = 9;
console.log("behind a store: dot " + F.A + ", key " + F["A"] + ", const key " + F[k] + ", chain " + F?.A + ", chained key " + F?.["A"]);
