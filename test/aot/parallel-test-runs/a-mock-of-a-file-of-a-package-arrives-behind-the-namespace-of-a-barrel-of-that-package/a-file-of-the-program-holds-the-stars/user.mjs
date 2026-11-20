import * as all from "./kit/wide.mjs";
import { round } from "./kit/wide.mjs";
export const look = () => [Object.keys(all).sort().join(), Reflect.get(all, "round"), all.round, round, Reflect.get(all, "flat"), Reflect.get(all, "added")].map(String).join(" ");
