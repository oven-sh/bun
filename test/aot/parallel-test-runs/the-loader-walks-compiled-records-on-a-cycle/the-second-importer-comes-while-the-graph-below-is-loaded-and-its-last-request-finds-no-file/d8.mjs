import { d9 } from "./d9.mjs";
(globalThis.order ??= []).push("d8");
export const d8 = () => "8" + d9();
