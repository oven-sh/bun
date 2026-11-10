import { value, bump } from "./m2.js";
import * as all from "./m1.js";
(globalThis.ran ??= []).push("u3");
export const look = () => [value, bump(), all.value, all.deep()].join("/");
export const later = async () => (await import("./m2.js")).value;
