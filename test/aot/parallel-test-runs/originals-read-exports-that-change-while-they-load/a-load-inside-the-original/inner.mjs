import { level } from "./config.cjs";
import * as config from "./config.cjs";
console.log("SAID inner runs", level, config.level);
export const look = () => level + " " + config.level;
