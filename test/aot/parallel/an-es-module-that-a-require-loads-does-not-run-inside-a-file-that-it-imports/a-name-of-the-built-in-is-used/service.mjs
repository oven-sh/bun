import { existsSync } from "node:fs";
import { util } from "./util.mjs";
import helper from "./helper.cjs";
export const service = util + ", helper is " + typeof helper + " " + typeof existsSync;
