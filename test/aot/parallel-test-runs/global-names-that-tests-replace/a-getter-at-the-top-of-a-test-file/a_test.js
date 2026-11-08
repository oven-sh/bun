// A test file lays a getter on a global name, reads the name into a variable that nothing reads, and puts the property back.
import { test } from "bun:test";
let reads = 0;
const real = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
Object.defineProperty(globalThis, "structuredClone", { configurable: true, get() { reads++; return undefined; } });
const unused = structuredClone;
structuredClone;
Object.defineProperty(globalThis, "structuredClone", real);
test("the getter ran", () => {
  console.log(reads);
});
