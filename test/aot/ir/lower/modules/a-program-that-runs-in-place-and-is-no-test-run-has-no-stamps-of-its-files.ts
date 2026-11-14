// A program that runs in place and is no test run: `bun build --compile --aot --compile-in-place`, `bun run --aot`. The executable runs later, also where its project no longer lies.
// It holds no file against the disk at its first load but one that may leave `require.cache`, and here none may: no record has the stamp of a file.
// RUN(STAMPS): link
// OPTIONS(STAMPS): runs-in-place
// STAMPS-NOT: sourcestamp
// STAMPS: module {{*}}path="{{*}}/steady.ts"
// STAMPS-NOT: sourcestamp
// A test run has the stamp of every file of the program: one that changes although the build saw nothing that writes it fails its load.
// RUN(TESTS): link
// OPTIONS(TESTS): runs-tests
// TESTS: module [[steady]] path="{{*}}/steady.ts"
// TESTS: sourcestamp module=[[steady]] low=

// FILE: main.ts
import { steady } from "./steady.ts";
console.log(steady, require("./required.cjs").value);

// FILE: steady.ts
export const steady = "steady";

// FILE: required.cjs
exports.value = "required";
