import { kind } from "./shared.cjs";
import { level } from "./config.cjs";
import * as all from "./config.cjs";
console.log("reader", kind, level, Object.keys(all).join());
