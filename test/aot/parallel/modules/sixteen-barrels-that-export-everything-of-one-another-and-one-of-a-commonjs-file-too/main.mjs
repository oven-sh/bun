import * as all from "./ring0.mjs";
import { shared } from "./ring7.mjs";
console.log(all.shared, shared, all.round, Object.keys(all).join());
