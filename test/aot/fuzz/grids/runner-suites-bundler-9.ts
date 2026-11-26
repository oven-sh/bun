import { holdProgramsOfSuites } from "../../harness/runner-suites";

holdProgramsOfSuites(
  "test/bundler/bundler_compile.test.ts",
  "test/bundler/bundler_compile_embedded.test.ts",
  "test/bundler/bundler_compile_imports.test.ts",
);
