import "./setup.js";
import { part } from "./part.js";
(globalThis.log ??= []).push("a");
export const a = () => part;
