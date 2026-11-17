import { kind } from "./shared.cjs";
import { level } from "./config.cjs";
import * as other from "./other.cjs";
console.log("reader", kind, level, Object.keys(other).join());
