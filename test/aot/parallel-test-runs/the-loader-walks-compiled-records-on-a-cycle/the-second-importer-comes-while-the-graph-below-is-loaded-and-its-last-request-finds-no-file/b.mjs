import { x } from "./x.mjs";
(globalThis.order ??= []).push("b");
export const b = () => "b" + x();
export const seen = b;
