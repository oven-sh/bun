// A `--define` whose value is one name reads the `const` of that name in one component of a file whose other component the React Compiler compiles.
// Flags: --define NAME=target --react-compiler
import { Local, Other } from "./Views";
(globalThis as any).target = "the global";
console.log("two components:", Local({ title: "first" }), Local({ title: "second" }), Other({ title: "third" }));
