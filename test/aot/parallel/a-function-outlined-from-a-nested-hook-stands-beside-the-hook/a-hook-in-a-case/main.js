// Flags: --react-compiler
// Reference: bun build --compile
import { make } from "./handlers.jsx";
const first = make(1)();
const second = make(1)();
console.log(first === second, first() + second(), make(2));
