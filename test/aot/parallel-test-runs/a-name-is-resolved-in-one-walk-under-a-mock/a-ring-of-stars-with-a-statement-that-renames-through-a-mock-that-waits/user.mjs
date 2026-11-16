import * as all from "./outer.mjs";
import { round as named } from "./outer.mjs";
const key = JSON.parse('"round"');
export const look = () =>
  [
    Object.keys(all).sort().join("+"),
    String(all.round),
    String(all[key]),
    String(Reflect.get(all, "round")),
    String(named),
  ].join(" ");
