import { measure, paint } from "./index.mjs";
import * as all from "./index.mjs";
import { paint as throughStar } from "./onward.mjs";
import { brush } from "./renamed.mjs";
const loaded = await import("./index.mjs");
function read(space) {
  let last = "";
  for (let turn = 0; turn < 300; turn++) last = space.paint;
  return last;
}
console.log(measure, paint, Object.keys(all).join(), read(all), throughStar, brush, loaded.paint, "paint" in all);
