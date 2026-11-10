import * as hub from "kit/hub.mjs";
import * as tail from "kit/tail.mjs";
const read = value => (typeof value === "function" ? value() : value);
export const list = space =>
  Object.keys(space)
    .sort()
    .map(key => key + "=" + String(read(Reflect.get(space, key))))
    .join() +
  " " +
  ("other" in space);
export const look = () => list(hub) + " | " + list(tail);
console.log("SAID ran new-reader.mjs");
