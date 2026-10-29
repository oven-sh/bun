import "./setup.mjs";
import { countedA, custom, late, fromSetup, sleep, version } from "bun";
import { countedB, custom as renamed } from "bun";
import * as all from "bun";
import bun from "bun";
note("first.mjs starts");
export { custom };
export const read = () => [custom, renamed, typeof late, fromSetup, sleep, countedA, countedB, countedA, typeof version, all.custom, bun.custom, typeof all.late, all === bun].join(" ");
