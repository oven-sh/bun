import tool from "./tool.cjs";
import { colors } from "./colors.mjs";
import * as fs from "node:fs";
export const panel = tool + " " + colors + " " + typeof fs.readFileSync;
