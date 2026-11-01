import whole from "./data.json";
import * as ns from "./data.json";
const held = ns;
whole.a = 99;
console.log(held.a, ns.a, held.default.a);
