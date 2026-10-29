// Entry points: ./beside.mjs
import { open } from "node:fs/promises";
const handle = await open("lines.txt");
let count = 0;
for await (const line of handle[JSON.parse('"readLines"')]()) count++;
console.log(count);
