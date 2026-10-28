// The places of ./two-kinds-of-object-at-one-place.ts as TypeScript, with the value declared as what the first kind is, the first kind never born, and read as that kind. Every place, on every road, holds nothing but
// misfits of its declared type: what Object.create, JSON.parse, a literal behind a cast or another class made. What the compiler believes of the declared type may not decide what happens.
import { programs as places } from "./two-kinds-of-object-at-one-place";

export { oneIn } from "./two-kinds-of-object-at-one-place";

export function programs() {
  return places("as the first kind, which never comes");
}
