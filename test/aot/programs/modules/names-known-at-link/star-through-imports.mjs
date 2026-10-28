import { right, through } from "./star-through.mjs";
import * as namespace from "./star-through.mjs";
export const seen = [right, through, Object.keys(namespace)];
