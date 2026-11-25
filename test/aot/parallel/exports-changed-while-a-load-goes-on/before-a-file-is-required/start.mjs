import "./config.cjs";
import "./changes.cjs";
import { level } from "./config.cjs";
import * as all from "./config.cjs";
console.log("start", level, all.level, Object.keys(all).join());
