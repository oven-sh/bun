// The one call of the method is copied, and the copy knows that count is 0: the promise is judged as written all the same, by the walk of the method's own body.
import type { int32 } from "bun";
class Counter {
  count: int32 = 0;
  bump(): void {
    this.count++;
  }
}
const counter = new Counter();
counter.bump();
console.log(counter.count);
/* Build errors:
error: TS100031: Property 'count' of 'Counter' is declared 'int32', but 'this.count++' might not be an int32: it can be anything from -2147483647 to 2147483648. Write 'this.count = (this.count + 1) | 0'.
*/
