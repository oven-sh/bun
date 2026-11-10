import { value } from "dep2";
import { wrapped } from "./wrap2.mjs";
(globalThis.order2 ??= []).push("own2");
export const own = () => value() + " " + wrapped();
