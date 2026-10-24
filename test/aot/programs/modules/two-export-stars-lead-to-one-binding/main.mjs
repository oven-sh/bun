// Two export stars lead to one binding.
import * as all from "./all.mjs";
import { x } from "./all.mjs";
console.log(Object.keys(all).join(), x, all.x);
