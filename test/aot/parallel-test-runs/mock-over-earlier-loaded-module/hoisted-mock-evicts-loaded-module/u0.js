import { value, bump } from "./m0.js";
import * as all from "./m1.js";
(globalThis.ran ??= []).push("u0");
export const look = () => [value, bump(), all.value, all.deep()].join("/");
export const later = async () => (await import("./m0.js")).value;
