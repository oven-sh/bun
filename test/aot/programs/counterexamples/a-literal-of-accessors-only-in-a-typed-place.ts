// An object literal that has only a getter initializes a variable of a written type.
declare const console: { log(...a: unknown[]): void };
const g: { x: number } = { get x() { return 5; } };
console.log(g.x);
