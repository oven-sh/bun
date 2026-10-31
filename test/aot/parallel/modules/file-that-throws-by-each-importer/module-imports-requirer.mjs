import { x } from "./requires-module.cjs"; globalThis.log.push("module x=" + x); export const seen = x;
