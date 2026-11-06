// Two or three object literals with the same keys, `{ id, part }`, whose parts are declared with different classes. A loop calls a member
// of the part of the first holder. That holder meets its own classes and one plain record, stored through `any` or under a key that nobody
// knows. The other holders meet objects that have no layout of their own: a literal handed to Object.assign, an object made by
// Object.create. The scenes are those of strangers-where-a-type-names-a-class.ts.
import type { Random } from "./random";
import { generateWithTheSameKeys } from "./strangers-where-a-type-names-a-class";

export function generate(random: Random): string {
  return generateWithTheSameKeys(random);
}
