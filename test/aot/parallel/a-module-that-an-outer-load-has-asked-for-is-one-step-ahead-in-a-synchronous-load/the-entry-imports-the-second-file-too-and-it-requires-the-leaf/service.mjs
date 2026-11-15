import * as zlib from "node:zlib";
import { util } from "./util.mjs";
import helper from "./helper.cjs";
import second from "./second.cjs";
export const service = util + ", helper is " + typeof helper + ", " + second;
