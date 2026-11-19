import { util } from "./util.mjs";
import helper from "./helper.cjs";
import second from "./second.cjs";
import third from "./third.cjs";
export const service = [util, typeof helper, typeof third, second].join(" ");
