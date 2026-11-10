import * as colors from "./colors.mjs";
import * as tool from "./tool.cjs";
(globalThis.order ??= []).push("shades");
export const shade = "shade(" + [colors.color, tool.label].join() + ")";
