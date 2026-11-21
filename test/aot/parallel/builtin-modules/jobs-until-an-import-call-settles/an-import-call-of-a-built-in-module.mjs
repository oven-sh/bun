// An import() of node:zlib and of node:path, which statements of the entry import too, and one of node:os, which nothing has loaded, settle behind the same jobs of a counted chain as in plain Bun.
import zlib from "node:zlib";
import { sep } from "node:path";
const log = [];
let chain = Promise.resolve();
for (let number = 1; number <= 40; number++) chain = chain.then(() => log.push(number));
const first = import("node:zlib").then(() => log.push("node:zlib"));
const second = import("node:path").then(() => log.push("node:path"));
const third = import("node:os").then(() => log.push("node:os"));
await chain;
await Promise.all([first, second, third]);
console.log(log.join(" "));
