import second from "./second.cjs";
import * as zlib from "node:zlib";
import { util } from "./util.mjs";
import helper from "./helper.cjs";
export const service = util + ", helper is " + typeof helper + " that gives " + helper() + ", " + second;
