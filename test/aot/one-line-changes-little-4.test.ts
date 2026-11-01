import { test } from "bun:test";
import { unsupported } from "./harness/compiler";
import { oneLineChangesLittle } from "./one-line-changes-little-cases";

if (unsupported) test.skip(unsupported, () => {});
else await oneLineChangesLittle(4, 8);
