import * as zlib from "node:zlib";
import { util } from "./util.mjs";
import helper from "./helper.cjs";
globalThis.order.push("begin service");
export const service = util + ", helper is " + typeof helper;
globalThis.order.push("end service");
