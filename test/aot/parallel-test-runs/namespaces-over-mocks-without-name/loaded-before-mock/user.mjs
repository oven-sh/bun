import * as all from "./outer.mjs";
import { round as named } from "./outer.mjs";
import { round as out } from "./aside.mjs";
export const look = () => [Object.keys(all).sort().join(), String(all.round), String(Reflect.get(all, "round")), String(named), String(out)].join(" | ");
