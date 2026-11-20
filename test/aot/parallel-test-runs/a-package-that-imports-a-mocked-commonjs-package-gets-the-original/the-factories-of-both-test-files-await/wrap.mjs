import { seen } from "reads";
(globalThis.order ??= []).push("wrap");
export const wrapped = () => seen();
