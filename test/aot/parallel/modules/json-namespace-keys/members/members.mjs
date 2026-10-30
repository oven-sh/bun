import * as ns from "./data.json";
import { a, zeta } from "./data.json";
const held = ns;
console.log(
  ns.a,
  ns.b,
  held.a,
  held.b,
  a,
  zeta === ns.zeta,
  zeta === held.zeta,
  zeta === ns.default.zeta,
  "a" in held,
  "missing" in held,
  held.missing,
);
