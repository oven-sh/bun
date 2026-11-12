import * as all from "node:path";
export const late = () =>
  [Object.keys(all).filter(name => ["sep", "made"].includes(name)).join(), all.sep, all.made, Reflect.get(all, "sep"), "made" in all].map(String).join(" ");
