// Built ins assorted: direct bench. It prints what plain Bun prints.
import { getSystemErrorName } from "node:util";
import net from "node:net";
const word = process.argv[2], rounds = Number(process.argv[3]);
let sum = 0;
if (word === "none") for (let i = 0; i < rounds; ++i) sum += i & 1;
else if (word === "family") for (let i = 0; i < rounds; ++i) sum += net.getDefaultAutoSelectFamily() ? 1 : 2;
else if (word === "errorName") for (let i = 0; i < rounds; ++i) sum += getSystemErrorName(-2 - (i & 1)).length;
else if (word === "sleep") for (let i = 0; i < rounds; ++i) Bun.sleepSync(0);
console.log(word, sum);
