import { d7 } from "./d7.mjs";
(globalThis.order ??= []).push("d6");
export const d6 = () => "6" + d7();
