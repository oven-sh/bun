import { util } from "./util.mjs";
import { named as helper } from "./helper.cjs";
(globalThis.order ??= []).push("begin service");
export const service = util + ", helper is " + typeof helper;
globalThis.order.push("end service");
