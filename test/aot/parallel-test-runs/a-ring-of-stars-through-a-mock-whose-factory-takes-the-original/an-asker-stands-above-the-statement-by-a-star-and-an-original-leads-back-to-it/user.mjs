import * as all from "./far.mjs";
import { round } from "./far.mjs";
export const look = () => [round, all.round, all[JSON.parse('"round"')], Reflect.get(all, "round"), "round" in all, Object.keys(all).join("+")].join("/");
