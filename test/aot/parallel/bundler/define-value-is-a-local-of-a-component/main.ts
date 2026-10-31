// A `--define` whose value is one name reads the `const` of that name in a component, not the global of that name. The React Compiler sees no read of the `const`, so the component runs as it is written.
// Flags: --define NAME=target --react-compiler
import { Typed } from "./Typed";
(globalThis as any).target = "the global";
console.log("through the define:", Typed({ title: "first" }), Typed({ title: "second" }));
