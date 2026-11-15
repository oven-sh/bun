import * as fs from "node:fs";
import helper from "./helper.cjs";
import { leaf } from "./leaf.mjs";
export const bridge = helper + ", " + leaf + " " + typeof fs;
