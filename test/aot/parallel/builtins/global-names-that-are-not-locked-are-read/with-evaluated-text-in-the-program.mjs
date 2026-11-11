// As a-getter-and-another-class, in a program that evaluates text.
let reads = 0;
let made = 0;
Object.defineProperty(globalThis, "structuredClone", { configurable: true, get() { reads++; return undefined; } });
globalThis.WeakMap = class { constructor() { made++; } };
const first = structuredClone;
structuredClone;
const second = new WeakMap();
console.log(reads + " " + made, (0, eval)("1 + 1"));
