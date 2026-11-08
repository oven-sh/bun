import * as shapes from "./shapes.mjs";
const name = ["Round", "Square"][JSON.parse("1")];
console.log(new shapes[name](3).area());
