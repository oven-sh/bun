import "./second.cjs";
import * as zlib from "node:zlib";
import { util } from "./util.mjs";
import { named } from "./helper.cjs";
export const service = util + ", helper is " + typeof named + ", " + globalThis.second;
