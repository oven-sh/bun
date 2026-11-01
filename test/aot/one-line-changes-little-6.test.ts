import { unsupported } from "./harness/compiler";
import { test } from "./listed";
import { oneLineChangesLittle } from "./one-line-changes-little-cases";

if (unsupported) test.skip(unsupported, () => {});
else await oneLineChangesLittle(6, 8);
