import { p } from "./written-p.mjs";
(globalThis.order ??= []).push("w");
export const w = () => "w" + p();
