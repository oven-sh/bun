// Flags: --react-compiler
// Reference: bun build --compile
import { make } from "./handlers.tsx";
console.log(make(1)()(), make(2)()());
