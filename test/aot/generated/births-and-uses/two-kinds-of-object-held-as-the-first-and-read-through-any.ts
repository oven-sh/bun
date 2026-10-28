// The places of ./two-kinds-of-object-at-one-place.ts as TypeScript, the value declared as what the first kind is and its members reached through a cast, `(v as any).a`. On two of the roads nothing but the second
// kind ever reaches the variable: a variable of a class that holds only what Object.create, Object.setPrototypeOf or a literal made.
import { programs as places } from "./two-kinds-of-object-at-one-place";

export { oneIn } from "./two-kinds-of-object-at-one-place";

export function programs() {
  return places("as the first kind, through any");
}
