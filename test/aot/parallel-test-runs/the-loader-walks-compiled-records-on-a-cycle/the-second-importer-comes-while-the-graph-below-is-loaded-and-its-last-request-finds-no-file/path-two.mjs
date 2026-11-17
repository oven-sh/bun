import { b } from "./b.mjs";
(globalThis.order ??= []).push("p2");
export const two = () => "q" + b();
