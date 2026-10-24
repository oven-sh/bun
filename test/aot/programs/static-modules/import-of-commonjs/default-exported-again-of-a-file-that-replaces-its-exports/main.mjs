import * as barrel from "./barrel.mjs";
import { old } from "./barrel.mjs";
console.log(Object.keys(barrel).join());
console.log(typeof old, old(2), barrel.old === old);
