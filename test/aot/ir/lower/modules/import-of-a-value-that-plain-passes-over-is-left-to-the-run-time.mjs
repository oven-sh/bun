// RUN(LOADER): link
// OPTIONS(LOADER): runs-in-place
// LOADER: module {{*}}path="#{{*}}exportRule=CommonJs{{*}}syntheticExports=[{name="hidden" variable=
// RUN(BUNDLE): link
// BUNDLE-NOT: syntheticExports=[{name="hidden"

// The object has the name, and whoever lists its names passes over it. `bun run` links by that list: the facade captures, the copy stays empty, and the check throws as its link does.
// The bundle of `bun build --compile` reads the name off the object, and finds it.
import { hidden, alias } from "./imports/values-that-are-not-enumerable/crate-with-a-getter.cjs";
console.log(hidden, alias);
