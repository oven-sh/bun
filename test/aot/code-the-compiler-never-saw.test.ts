import { test } from "bun:test";
import { codeTheCompilerNeverSaw } from "./code-the-compiler-never-saw-cases";
import { unsupported } from "./harness/compiler";

if (unsupported) test.skip(unsupported, () => {});
else codeTheCompilerNeverSaw();
