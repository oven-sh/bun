import ring from "./ring.cjs";
import { util } from "./util.mjs";
(globalThis.order ??= []).push("begin back");
export const seen = Object.keys(ring).join(",") + " " + util;
globalThis.order.push("end back");
