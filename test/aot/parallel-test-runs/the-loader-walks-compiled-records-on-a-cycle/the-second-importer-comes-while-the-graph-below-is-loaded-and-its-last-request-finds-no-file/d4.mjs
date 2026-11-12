import { d5 } from "./d5.mjs";
(globalThis.order ??= []).push("d4");
export const d4 = () => "4" + d5();
