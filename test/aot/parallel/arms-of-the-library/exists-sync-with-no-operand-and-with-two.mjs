import { existsSync } from "node:fs";
let n = 0;
for (let i = 0; i < 3; i++) n += existsSync("/") ? 1 : 0;
console.log(n, existsSync(), existsSync("/nowhere-at-all", "/"), existsSync.length, existsSync.name);
