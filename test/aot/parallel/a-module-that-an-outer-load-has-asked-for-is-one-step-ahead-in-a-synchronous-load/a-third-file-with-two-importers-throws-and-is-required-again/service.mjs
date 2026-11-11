import second from "./second.cjs";
import * as zlib from "node:zlib";
import { util } from "./util.mjs";
import helper from "./helper.cjs";
import third from "./third.cjs";
import { side1 } from "./side1.mjs";
export const service = [util, typeof helper, typeof third, second, side1].join(" ");
