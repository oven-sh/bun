import { open } from "node:fs/promises";
const handle = await open("lines.txt");
console.log(typeof handle.readLines, Object.getOwnPropertyNames(Object.getPrototypeOf(handle)).includes("readLines"));
await handle.close();
