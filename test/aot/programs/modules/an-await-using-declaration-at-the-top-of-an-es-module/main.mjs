// An await using declaration at the top of an es module.
import { a, log } from "./m.mjs";
import { order } from "./n.mjs";
console.log(a, log.join(), order);
