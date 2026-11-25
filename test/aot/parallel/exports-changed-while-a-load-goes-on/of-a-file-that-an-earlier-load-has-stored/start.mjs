import { kind } from "./shared.cjs";
import "./config.cjs";
import "./changes.cjs";
import * as all from "./config.cjs";
console.log("start", kind, all.level, Object.keys(all).join());
