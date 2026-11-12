import * as all from "./kit/hub.mjs";
import { one, sep as named } from "./kit/hub.mjs";
const mine = new Set(["one", "added", "sep"]);
export const look = () =>
  [
    Object.keys(all)
      .filter(key => mine.has(key))
      .sort()
      .join(),
    Reflect.get(all, "one"),
    one,
    Reflect.get(all, "sep"),
    all.sep,
    named,
    "sep" in all,
  ]
    .map(String)
    .join(" ");
