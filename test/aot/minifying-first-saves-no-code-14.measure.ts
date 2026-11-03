import { test } from "bun:test";
import { unsupported } from "./harness/compiler";
import { minifyingFirstInParts } from "./minifying-first-saves-no-code-cases";

if (unsupported) test.skip(unsupported, () => {});
else await minifyingFirstInParts(14, 16);
