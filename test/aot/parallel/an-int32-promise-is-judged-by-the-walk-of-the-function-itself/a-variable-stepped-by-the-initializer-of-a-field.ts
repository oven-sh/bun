// The initializer is named by the body of the constructor alone, and the one construction is copied.
import type { int32 } from "bun";
let made: int32 = 0;
class Tally {
  order: number = made++;
}
console.log(new Tally().order, made);
/* Build errors:
error: TS100031: 'made' is declared 'int32', but 'made++' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write '((made = (made + 1) | 0) - 1) | 0'.
*/
