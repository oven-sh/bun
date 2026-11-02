import * as front from "./front.mjs";
import { bun } from "./front.mjs";
console.log(bun === front.bun, Object.keys(front).join());
