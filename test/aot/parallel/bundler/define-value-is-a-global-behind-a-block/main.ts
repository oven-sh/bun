// A `--define` whose value is one name reads the global of that name in a component that the React Compiler has compiled, behind a block of the component that declares a `const` of that name.
// Flags: --define NAME=target --react-compiler
import { View } from "./View";
(globalThis as any).target = "the global";
console.log("behind a block:", View({ title: "first" }), View({ title: "second" }));
