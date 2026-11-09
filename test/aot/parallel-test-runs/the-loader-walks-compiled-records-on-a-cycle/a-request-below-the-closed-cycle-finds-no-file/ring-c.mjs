import { a } from "./ring-a.mjs";
import { one } from "./tail-one.mjs";
(globalThis.order ??= []).push("c");
export const c = () => "c" + typeof a + one();
