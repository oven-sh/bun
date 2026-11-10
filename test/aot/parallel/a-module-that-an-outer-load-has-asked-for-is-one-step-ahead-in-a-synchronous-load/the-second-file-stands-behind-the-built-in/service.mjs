import * as zlib from "node:zlib";
import second from "./second.cjs";
import { util } from "./util.mjs";
import helper from "./helper.cjs";
export const service = util + ", helper is " + typeof helper + ", " + second;
