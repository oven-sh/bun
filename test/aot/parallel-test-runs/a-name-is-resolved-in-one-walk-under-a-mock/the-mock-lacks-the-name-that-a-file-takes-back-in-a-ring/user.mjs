import * as all from "./outer.mjs";
export const look = () =>
  Object.keys(all).join() + " " + [Reflect.get(all, "round"), Reflect.get(all, "only")].map(String).join(" ");
