// The places of ./two-kinds-of-object-at-one-place.ts as TypeScript, the value declared as the union of the two kinds and its members reached through a cast, `(v as any).a`: so a program reads what the declared
// type lacks. Behind the cast the compiler knows no more of the value than what it has proven of the variable.
import { programs as places } from "./two-kinds-of-object-at-one-place";

export { oneIn } from "./two-kinds-of-object-at-one-place";

export function programs() {
  return places("through any");
}
