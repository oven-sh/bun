import { one } from "./path-one.mjs";
(globalThis.order ??= []).push("x");
export const x = () => "x" + one();
