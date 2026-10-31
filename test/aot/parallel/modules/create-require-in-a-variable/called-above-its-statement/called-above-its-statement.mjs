import { createRequire } from "node:module";
try {
  made("./lib/statement.cjs");
} catch (error) {
  console.log(error.name);
}
try {
  console.log(made("./lib/local.cjs").name);
} catch (error) {
  console.log(error.name);
}
var made = createRequire(import.meta.url);
made("./lib/statement.cjs");
console.log(made("./lib/local.cjs").name);
