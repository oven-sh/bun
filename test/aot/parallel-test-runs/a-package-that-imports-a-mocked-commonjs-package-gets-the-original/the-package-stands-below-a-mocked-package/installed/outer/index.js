import { seen } from "reads";
(globalThis.order ??= []).push("outer");
export const wrapped = () => seen();
