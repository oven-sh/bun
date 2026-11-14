// Flags: --react-compiler
// Reference: bun build --compile
import { make } from "./handlers.jsx";
const first = make()();
const second = make()();
console.log(first === second, first() + second());
