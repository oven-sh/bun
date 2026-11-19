import { two } from "./tail-two.mjs";
(globalThis.order ??= []).push("t1");
export const one = () => "1" + two();
