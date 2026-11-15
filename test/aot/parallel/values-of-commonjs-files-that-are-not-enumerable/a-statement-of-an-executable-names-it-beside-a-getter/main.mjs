// Reference: bun build --compile
// `bun run` links by the names that the object lists, and throws a SyntaxError. The bundle reads the name off the object.
import { hidden, alias } from "./crate.cjs";
console.log(String(hidden), String(alias));
