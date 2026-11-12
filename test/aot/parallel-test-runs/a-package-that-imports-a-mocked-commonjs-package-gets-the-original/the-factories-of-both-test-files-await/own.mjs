import { value } from "dep";
import { wrapped } from "./wrap.mjs";
(globalThis.order ??= []).push("own");
export const own = () => value() + " " + wrapped();
