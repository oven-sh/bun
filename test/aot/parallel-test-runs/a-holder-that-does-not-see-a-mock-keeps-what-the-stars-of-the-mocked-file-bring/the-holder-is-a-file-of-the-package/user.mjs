import * as all from "kit/hub.mjs";
import { one, other as named } from "kit/hub.mjs";
const mine = new Set(["one", "added", "other"]);
export const look = () =>
  [
    Object.keys(all)
      .filter(key => mine.has(key))
      .sort()
      .join(),
    Reflect.get(all, "one"),
    one,
    Reflect.get(all, "other"),
    all.other,
    named,
    "other" in all,
  ]
    .map(String)
    .join(" ");
