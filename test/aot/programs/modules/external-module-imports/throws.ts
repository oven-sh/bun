import { dirname } from "node:path";
import { log } from "./log.ts";
import { types } from "node:util";
log("throws is evaluated: " + dirname("/a/b") + " " + types.isDate(new Date(0)));
export const never = 1;
throw new Error("thrown while it was evaluated");
