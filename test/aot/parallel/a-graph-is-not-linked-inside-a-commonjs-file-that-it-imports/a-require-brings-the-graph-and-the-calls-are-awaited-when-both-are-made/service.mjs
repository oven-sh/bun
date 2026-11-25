import helper from "./helper.cjs";
import { util } from "./util.mjs";
(globalThis.order ??= []).push("begin service");
export const service = util + ", helper is " + typeof helper;
globalThis.order.push("end service");
