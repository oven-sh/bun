import { custom, late } from "bun";
import { custom as fromFirst } from "./first.mjs";
note("second.mjs starts");
export const read = () => [custom, late, fromFirst, (() => custom)(), eval("custom")].join(" ");
