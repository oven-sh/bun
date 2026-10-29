import * as ns from "./data.json";
const held: Record<string, unknown> = ns;
console.log(Object.keys(held).join(), ns.a + ns.b, ns.zeta.x);
