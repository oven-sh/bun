import { seen } from "reads2";
(globalThis.order2 ??= []).push("wrap2");
export const wrapped = () => seen();
