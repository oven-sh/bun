import { x } from "./x.mjs";
(globalThis.order ??= []).push("a");
export const a = () => "a" + x();
