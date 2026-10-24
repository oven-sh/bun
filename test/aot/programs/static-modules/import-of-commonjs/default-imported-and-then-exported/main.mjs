import * as barrel from "./barrel.mjs";
import { old, again } from "./barrel.mjs";
console.log(Object.keys(barrel).join());
console.log(typeof old, old.name, old.make().length, old === again, barrel.old === old);
