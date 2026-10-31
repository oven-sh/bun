import whole from "./data.json";
import * as ns from "./data.json";
whole.a = 99;
whole.added = 1;
delete whole.b;
const held = ns;
console.log(held.a, ns.a, held.b, ns.b, held.added, Object.keys(held).join(), held.default === whole);
