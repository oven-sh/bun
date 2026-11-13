import * as all from "./last.mjs";
import * as barrel from "./wide.mjs";
import { round } from "./last.mjs";
import { round as direct } from "./wide.mjs";
export const look = () =>
  [Object.keys(all).join(), all.round, Reflect.get(all, "round"), round, "|", Object.keys(barrel).join(), barrel.round, direct].join(" ");
