import { b } from "./ring-b.mjs";
(globalThis.order ??= []).push("a");
export const a = () => "a" + typeof b;
