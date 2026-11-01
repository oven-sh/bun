// Two or three object literals with the same keys, `{ id, part }`, whose parts are declared with different classes. A
// loop calls a member of the first holder's part. That holder sees its own classes and one plain record, stored through
// `any` or under a computed key.
import type { Random } from "./random";
import { generateWithTheSameKeys } from "./non-instances-under-class-type";

export function generate(random: Random): string {
  return generateWithTheSameKeys(random);
}
