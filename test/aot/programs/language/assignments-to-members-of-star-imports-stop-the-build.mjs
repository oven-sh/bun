// The function assigns to members of star imports and deletes them, each in another way. It is never called.
import * as star from "node:path";
import * as byKey from "node:path";
import * as byIndex from "node:path";
import * as deletedByKey from "node:path";
function never(key) {
  star.assigned = 1;
  star.sep = 1;
  star["quoted"] = 1;
  byKey[key] = 1;
  byIndex[0] = 1;
  star.added += 1;
  star.defaulted ||= 1;
  star.conjoined &&= 1;
  star.default = 1;
  star.incremented++;
  --star.decremented;
  [star.element] = [1];
  [star.elementWithDefault = 0] = [1];
  [...star.rest] = [1];
  ({ a: star.property } = { a: 1 });
  for (star.ofLoop of [1]);
  for (star.inLoop in { a: 1 });
  (star).behindParentheses = 1;
  (star.insideParentheses) = 1;
  delete star.deleted;
  delete star["deletedQuoted"];
  delete deletedByKey[key];
}
globalThis.kept = never;
console.log("ran");
