import { one } from "./named.mjs";
const first = await import("./named.mjs");
const second = await import("./named.mjs");
const name = ["./na", "med.mjs"].join("");
const third = await import(name);
console.log(one(), first.one(), first === second, first === third, Object.keys(first).join());
