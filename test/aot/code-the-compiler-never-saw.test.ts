import { codeTheCompilerNeverSaw } from "./code-the-compiler-never-saw-cases";
import { unsupported } from "./harness/compiler";
import { test } from "./harness/declare";

if (unsupported) test.skip(unsupported, () => {});
else codeTheCompilerNeverSaw();
