// `export default class {}` is named "default".
import c from "./main.js";
export default class {}
console.log(JSON.stringify(c.name));
