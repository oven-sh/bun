import second from "./second.cjs";
import * as zlib from "node:zlib";
import { util } from "./util.mjs";
import * as star from "./helper.cjs";
export const service = util + ", helper is " + typeof star.default + ", " + second;
