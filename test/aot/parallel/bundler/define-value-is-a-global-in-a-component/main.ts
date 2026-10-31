// A `--define` whose value is one name reads the global of that name in a component that the React Compiler has compiled. The compiler's output calls the parameter of the component `t0` too.
// Flags: --define NAME=t0 --react-compiler
import { View } from "./View";
(globalThis as any).t0 = "the global";
console.log("in a component:", View({ title: "first" }), View({ title: "second" }));
