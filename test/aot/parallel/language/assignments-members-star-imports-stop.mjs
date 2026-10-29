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
/* Build errors:
error: TS2540: Cannot assign to 'assigned' because it is a read-only property.
error: TS2540: Cannot assign to 'sep' because it is a read-only property.
error: TS2540: Cannot assign to 'quoted' because it is a read-only property.
error: TS2632: Cannot assign to 'byKey' because it is an import.
error: TS2632: Cannot assign to 'byIndex' because it is an import.
error: TS2540: Cannot assign to 'added' because it is a read-only property.
error: TS2540: Cannot assign to 'defaulted' because it is a read-only property.
error: TS2540: Cannot assign to 'conjoined' because it is a read-only property.
error: TS2540: Cannot assign to 'default' because it is a read-only property.
error: TS2540: Cannot assign to 'incremented' because it is a read-only property.
error: TS2540: Cannot assign to 'decremented' because it is a read-only property.
error: TS2540: Cannot assign to 'element' because it is a read-only property.
error: TS2540: Cannot assign to 'elementWithDefault' because it is a read-only property.
error: TS2540: Cannot assign to 'rest' because it is a read-only property.
error: TS2540: Cannot assign to 'property' because it is a read-only property.
error: TS2540: Cannot assign to 'ofLoop' because it is a read-only property.
error: TS2540: Cannot assign to 'inLoop' because it is a read-only property.
error: TS2540: Cannot assign to 'behindParentheses' because it is a read-only property.
error: TS2540: Cannot assign to 'insideParentheses' because it is a read-only property.
error: TS2704: The operand of a 'delete' operator cannot be a read-only property.
error: TS2632: Cannot assign to 'deletedByKey' because it is an import.
*/
