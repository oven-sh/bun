import { shade } from "./shades.mjs";
import { color } from "./colors.mjs";
(globalThis.order ??= []).push("panel");
export const panel = "panel(" + [shade, color].join() + ")";
