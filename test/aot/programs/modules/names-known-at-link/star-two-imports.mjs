import { left, right } from "./star-two.mjs";
import * as namespace from "./star-two.mjs";
export const seen = [left, right, Object.keys(namespace)];
