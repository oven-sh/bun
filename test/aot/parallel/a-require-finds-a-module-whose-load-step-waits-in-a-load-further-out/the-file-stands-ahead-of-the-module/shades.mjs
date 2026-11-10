import * as tool from "./tool.cjs";
import * as colors from "./colors.mjs";
(globalThis.order ??= []).push("shades");
export const shade = "shade(" + [colors.color, tool.label].join() + ")";
