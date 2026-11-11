import * as all from "./m3.js";
import { value, bump } from "./m0.js";
(globalThis.ran ??= []).push("u2");
export const look = () => [value, bump(), all.value, all.deep()].join("/");
export const later = async () => (await import("./m0.js")).value;
