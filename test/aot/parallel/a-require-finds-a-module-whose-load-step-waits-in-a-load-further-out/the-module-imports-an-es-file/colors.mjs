import names from "./names.mjs";
(globalThis.order ??= []).push("colors");
export const color = "color(" + names.length + ")";
