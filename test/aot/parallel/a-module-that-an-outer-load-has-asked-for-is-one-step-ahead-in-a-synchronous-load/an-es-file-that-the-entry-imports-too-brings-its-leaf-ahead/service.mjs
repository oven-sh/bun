import * as zlib from "node:zlib";
import { left } from "./left.mjs";
import { right } from "./right.mjs";
(globalThis.order ??= []).push("begin service");
export const service = left + " " + right;
globalThis.order.push("end service");
