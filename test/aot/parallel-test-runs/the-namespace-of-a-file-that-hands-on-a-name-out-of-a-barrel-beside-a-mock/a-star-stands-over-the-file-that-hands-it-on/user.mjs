import * as all from "./last.mjs";
import { round } from "./last.mjs";
export const look = () =>
  [Object.keys(all).join(), all.round, Reflect.get(all, "round"), JSON.stringify(Object.getOwnPropertyDescriptor(all, "round")), round].join(" ");
