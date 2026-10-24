declare const console: { log(...a: unknown[]): void };
const Bound = (class {}).bind(null);
const k = [class extends Bound {}];
console.log("evaluated");
export function read() { return k; }
