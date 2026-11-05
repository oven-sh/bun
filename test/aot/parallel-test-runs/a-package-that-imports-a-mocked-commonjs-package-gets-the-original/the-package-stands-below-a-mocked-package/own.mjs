import { value } from "dep";
import { wrapped } from "outer";
(globalThis.order ??= []).push("own");
export const own = () => value() + " " + wrapped();
