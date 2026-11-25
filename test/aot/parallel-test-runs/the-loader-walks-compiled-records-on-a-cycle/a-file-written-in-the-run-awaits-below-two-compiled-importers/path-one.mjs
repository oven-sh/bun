import { y } from "./y.mjs";
(globalThis.order ??= []).push("p1");
export const one = () => "1" + y();
