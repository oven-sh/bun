import * as keys from "./keys.mjs";
import { evaluate } from "./keys.mjs";
const stack = () => new Error("made up").stack ?? "";
export const Proto = {
  [evaluate](keep) { const s = stack(); return keep > 0 ? s : ""; },
};
export const make = options => ({ ...Proto, [keys.evaluate + "/made"](keep) { const s = stack(); return keep > 0 ? s : ""; }, ...options });
