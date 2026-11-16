import { level } from "./config.cjs";
import * as config from "./config.cjs";
import "./changes.cjs";
console.log("SAID reader runs", level, config.level);
export const look = () => level + " " + config.level;
