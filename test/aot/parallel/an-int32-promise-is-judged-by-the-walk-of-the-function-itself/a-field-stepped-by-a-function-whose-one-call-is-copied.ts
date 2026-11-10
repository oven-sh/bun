// The one call is copied, and the copy knows the fields of the object that the file has just made.
import type { int32 } from "bun";
type Counter = { count: int32 };
const counter: Counter = { count: 0 };
function bump(): void {
  counter.count++;
}
bump();
console.log(counter.count);
/* Build errors:
error: TS100031: Property 'count' of 'Counter' is declared 'int32', but 'counter.count++' might not be an int32: it can be anything from -2147483647 to 2147483648. Write 'counter.count = (counter.count + 1) | 0'.
*/
