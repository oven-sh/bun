import { nobody } from "./ring-a.mjs";
(globalThis.order ??= []).push("t2");
export const two = () => "2" + typeof nobody;
