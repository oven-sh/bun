import { c } from "./ring-c.mjs";
(globalThis.order ??= []).push("b");
export const b = () => "b" + typeof c;
export const seen = b;
