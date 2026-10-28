// The places of ./two-kinds-of-object-at-one-place.ts as TypeScript, with the value declared as what the first kind is. A program does that wherever it takes what JSON.parse, Object.create or a proxy hands it for an
// instance of a class. The place is hot with honest values and then gets the other kind: what the compiler believes of the declared type may not decide what happens.
import { programs as places } from "./two-kinds-of-object-at-one-place";

export { oneIn } from "./two-kinds-of-object-at-one-place";

export function programs() {
  return places("as the first kind");
}
