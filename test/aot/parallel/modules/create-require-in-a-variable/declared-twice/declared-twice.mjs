import { createRequire } from "node:module";
var made = createRequire(import.meta.url);
var made = name => "the second declaration got " + name;
console.log(made("./lib/local.cjs"));
