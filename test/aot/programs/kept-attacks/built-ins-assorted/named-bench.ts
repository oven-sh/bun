// Built ins assorted: named bench. It prints what plain Bun prints.
import { isAbsolute, dirname } from "node:path";
const word = process.argv[2], rounds = Number(process.argv[3]);
const names: string[] = ["/a/b.txt", "c/d", "/e"];
let sum = 0;
if (word === "none") for (let i = 0; i < rounds; ++i) sum += names[i % 3].length;
else if (word === "isAbsolute") for (let i = 0; i < rounds; ++i) sum += isAbsolute(names[i % 3]) ? 1 : 2;
else if (word === "dirname") for (let i = 0; i < rounds; ++i) sum += dirname(names[i % 3]).length;
console.log(word, sum);
