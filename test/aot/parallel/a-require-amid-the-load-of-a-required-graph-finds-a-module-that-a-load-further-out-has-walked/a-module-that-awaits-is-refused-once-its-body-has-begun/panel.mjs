import tool from "./tool.cjs";
import { colors } from "./colors.mjs";
import * as fs from "node:fs";
(globalThis.order ??= []).push("panel");
export const panel = typeof fs.readFileSync;
