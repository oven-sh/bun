import { d6 } from "./d6.mjs";
(globalThis.order ??= []).push("d5");
export const d5 = () => "5" + d6();
