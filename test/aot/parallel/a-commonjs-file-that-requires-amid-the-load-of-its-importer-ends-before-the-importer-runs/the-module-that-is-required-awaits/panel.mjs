import * as zlib from "node:zlib";
import { color } from "./colors.mjs";
import tool from "./tool.cjs";
export const panel = color + ", tool is " + typeof tool;
