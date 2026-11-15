import { d4 } from "./d4.mjs";
(globalThis.order ??= []).push("d3");
export const d3 = () => "3" + d4();
