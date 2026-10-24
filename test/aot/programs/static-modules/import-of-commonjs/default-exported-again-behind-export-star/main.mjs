import * as barrel from "./barrel.mjs";
import { old } from "./outer.mjs";
console.log(Object.keys(barrel).join());
console.log(typeof old, old.name, old.make().length, old === barrel.old);
