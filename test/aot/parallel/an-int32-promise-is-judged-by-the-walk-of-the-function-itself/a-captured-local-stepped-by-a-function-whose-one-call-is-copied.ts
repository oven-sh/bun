// The one call is copied, and the copy knows that count is 0. The function is walked by itself too, and there the step may leave the range.
import type { int32 } from "bun";
function run(): number {
  let count: int32 = 0;
  function bump(): void {
    count++;
  }
  bump();
  return count;
}
console.log(run());
/* Build errors:
error: TS100031: 'count' is declared 'int32', but 'count++' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'count = (count + 1) | 0'.
*/
