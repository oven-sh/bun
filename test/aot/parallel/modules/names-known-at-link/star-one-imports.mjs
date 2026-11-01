import { left, own } from "./star-one.mjs";
import * as namespace from "./star-one.mjs";
export const seen = [left, own, Object.keys(namespace), namespace.both];
