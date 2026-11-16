import second from "./second.cjs";
import * as zlib from "node:zlib";
import { util } from "./util.mjs";
import helper from "./helper.cjs";
(globalThis.order ??= []).push("begin service");
export const service = util + ", helper is " + typeof helper + ", " + second;
globalThis.order.push("end service");
