import * as fs from "node:fs";
(globalThis.order ??= []).push("colors");
export const colors = typeof fs.readFileSync;
