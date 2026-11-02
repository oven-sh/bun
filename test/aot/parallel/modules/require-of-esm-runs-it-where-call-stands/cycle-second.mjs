import { log } from "./log.mjs";
log("second begins");
const first = require("./cycle-first.mjs");
export const seen = typeof first;
log("second ends");
