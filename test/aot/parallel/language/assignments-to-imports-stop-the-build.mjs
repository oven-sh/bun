// The function assigns to each kind of import in another way. It is never called.
import whole from "node:path";
import * as star from "node:path";
import { basename, delimiter, dirname, extname, format, join as renamed, sep } from "node:path";
function never() {
  whole = 1;
  star = 1;
  sep = 1;
  renamed += 1;
  delimiter ||= 1;
  basename++;
  [dirname] = [1];
  ({ extname } = { extname: 1 });
  for (format of [1]);
}
globalThis.kept = never;
console.log("ran");
/* Build errors:
error: TS2632: Cannot assign to 'whole' because it is an import.
error: TS2632: Cannot assign to 'star' because it is an import.
error: TS2632: Cannot assign to 'sep' because it is an import.
error: TS2632: Cannot assign to 'renamed' because it is an import.
error: TS2632: Cannot assign to 'delimiter' because it is an import.
error: TS2632: Cannot assign to 'basename' because it is an import.
error: TS2632: Cannot assign to 'dirname' because it is an import.
error: TS2632: Cannot assign to 'extname' because it is an import.
error: TS2632: Cannot assign to 'format' because it is an import.
*/
