import { open } from "node:fs/promises";
const box = JSON.parse("{}");
box.handle = await open("lines.txt");
let count = 0;
for await (const line of box.handle.readLines()) count++;
console.log(count);
