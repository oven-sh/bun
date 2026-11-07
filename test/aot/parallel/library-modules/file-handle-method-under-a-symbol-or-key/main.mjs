import { open } from "node:fs/promises";
globalThis.kept = await open("lines.txt");
const handle = Reflect.get(globalThis, "kept");
const named = key => Reflect.get(globalThis, "a key that nobody has set") ?? key;
await handle[named(Symbol.asyncDispose)]();
console.log(handle.fd);
