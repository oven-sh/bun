import { two } from "./path-two.mjs";
(globalThis.order ??= []).push("p1");
export const one = () => "p" + two();
