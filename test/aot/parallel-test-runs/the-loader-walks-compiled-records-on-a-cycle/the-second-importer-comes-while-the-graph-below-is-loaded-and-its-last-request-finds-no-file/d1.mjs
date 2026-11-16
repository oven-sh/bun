import { d2 } from "./d2.mjs";
(globalThis.order ??= []).push("d1");
export const d1 = () => "1" + d2();
