import { a } from "./ring-a.mjs";
(globalThis.order ??= []).push("c");
export const c = () => "c" + typeof a;
