import * as all from "./wall.mjs";
import { grout } from "./wall.mjs";
const key = ["gro", "ut"].join("");
export const look = () => [grout, all.grout, all[key], key in all, Object.keys(all).sort().join()].map(String).join(" | ");
