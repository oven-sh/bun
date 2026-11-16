import { d3 } from "./d3.mjs";
(globalThis.order ??= []).push("d2");
export const d2 = () => "2" + d3();
