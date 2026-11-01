import { codeTheCompilerNeverSaw } from "./code-the-compiler-never-saw-cases";
import { unsupported } from "./harness/compiler";
import { test } from "./listed";

if (unsupported) test.skip(unsupported, () => {});
else codeTheCompilerNeverSaw();
