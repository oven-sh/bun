import "./setup.js";
import { part } from "./part.js";
import { other } from "./other.js";
(globalThis.log ??= []).push("a");
export const a = () => [part, other, globalThis.seen].join("|");
