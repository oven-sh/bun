import * as all from "./last.mjs";
import { bowed } from "./last.mjs";
export const look = () =>
  [Object.keys(all).join(), all.bowed, Reflect.get(all, "bowed"), JSON.stringify(Object.getOwnPropertyDescriptor(all, "bowed")), bowed].join(" ");
