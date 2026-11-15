import { shades } from "./shades.mjs";
(globalThis.order ??= []).push("colors");
export const colors = "colors" + shades;
