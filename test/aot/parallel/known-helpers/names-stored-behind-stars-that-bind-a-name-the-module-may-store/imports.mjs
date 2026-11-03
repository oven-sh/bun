import { one, two, late } from "./barrels/middle-name-of-the-star.js";
import { two as twoBetween, four, late as lateBetween, last } from "./barrels/between-two-stars.js";
import { four as fourOfOuter, middle, outer } from "./barrels/outer.js";
import { late as lateOfOutermost, one as oneOfOutermost, end, first, outermost } from "./barrels/outermost.js";
import { name00, name40, name89, two as twoBehindManyNames } from "./barrels/many-names-in-front.js";
import * as everyName from "./barrels/every-name-of-the-star.js";
import * as deleted from "./barrels/deleted-and-bound-by-the-next-star.js";
const list = names => Object.keys(names).map(key => key + "=" + (typeof names[key] === "object" ? "object" : names[key])).join(" ");
export default [
  [one, two, late],
  [twoBetween, four, lateBetween, last],
  [fourOfOuter, middle, outer],
  [lateOfOutermost, oneOfOutermost, end, first, outermost],
  [name00, name40, name89, twoBehindManyNames],
  [list(everyName)],
  [list(deleted)],
]
  .map(line => line.join(" | "))
  .join("\n");
