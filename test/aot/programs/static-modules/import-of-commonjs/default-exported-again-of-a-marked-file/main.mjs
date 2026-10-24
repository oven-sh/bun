import * as barrel from "./barrel.mjs";
import { old } from "./barrel.mjs";
console.log(Object.keys(barrel).join());
console.log(typeof old, JSON.stringify(old), barrel.old === old);
