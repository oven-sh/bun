import whole from "./data.json";
import { first, zeta } from "./re-export.mjs";
whole.a = 99;
console.log(first, zeta === whole.zeta);
