import { p } from "./written-p.mjs";
import { w } from "./w.mjs";
(globalThis.order ??= []).push("y");
export const y = () => "y" + p() + typeof w;
export const seen = y;
