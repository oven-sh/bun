import * as tools from "./tools.mjs";
import { legacy } from "./legacy.cjs";
export const seen = () => Object.keys(tools).join() + " " + String(tools.hammer) + " " + legacy;
