import { log } from "./log.mjs";
log("first begins");
const second = require("./cycle-second.mjs");
export const name = "first";
export const seenBySecond = second.seen;
log("first ends");
