import { d1 } from "./d1.mjs";
(globalThis.order ??= []).push("x");
export const x = () => "x" + d1();
export const seen = x;
