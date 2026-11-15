import * as zlib from "node:zlib";
import { ring } from "./middle.mjs";
import { util } from "./util.mjs";
(globalThis.order ??= []).push("begin back");
export const seen = Object.keys(ring).join(",") + " " + util;
globalThis.order.push("end back");
