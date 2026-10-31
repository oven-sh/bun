// A `--define` whose value is one name reads the prop of that name in a component, not the global of that name. The React Compiler sees no read of the prop, so the component runs as it is written.
// Flags: --define NAME=target --react-compiler
import { Prop } from "./Prop";
(globalThis as any).target = "the global";
console.log("a prop:", Prop({ target: "first" }), Prop({ target: "second" }));
