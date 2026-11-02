// A macro import is no variable when the program runs, and a macro is called only where the program writes its name. A `--define` whose value is the name of a macro import is the global of that name, where it is called and where it is read.
// Flags: --define CALL=stamp
import { stamp } from "./macro.js" with { type: "macro" };
globalThis.stamp = () => "the global at run time";
const read = CALL;
console.log(CALL(), read());
