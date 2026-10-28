import { read } from "./reader";
const which = process.argv.length > 100 ? "other" : "color";
console.log(read());
require(`./${which}.ts`).Color.Green = 9;
console.log(read());
