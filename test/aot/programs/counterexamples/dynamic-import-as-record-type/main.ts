// `await import(..)` initializes a variable of a record type.
declare const console: { log(...values: unknown[]): void };
const b: { programs: number[] } = await import("./m.ts");
console.log(b.programs.length);
const c = await import("./m.ts");
console.log(c.programs.length + c.f(1));
