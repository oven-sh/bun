// The uses from ./two-object-kinds-one-use.ts as TypeScript: the value is declared as the first kind, the first kind is
// never allocated, and members are read through a cast, `(v as any).a`. Every use only ever sees values that do not
// match the declared type.
import { programs as places } from "./two-object-kinds-one-use";

export { oneIn } from "./two-object-kinds-one-use";

export function programs() {
  return places("as the first kind, which never comes, through any");
}
