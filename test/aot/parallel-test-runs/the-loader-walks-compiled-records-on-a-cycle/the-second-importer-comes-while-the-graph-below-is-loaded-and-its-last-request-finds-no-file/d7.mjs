import { d8 } from "./d8.mjs";
(globalThis.order ??= []).push("d7");
export const d7 = () => "7" + d8();
