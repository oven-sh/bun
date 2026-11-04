// An alias in the file of an enum stores to it. `bun build` has the members that it knows in place of their reads in every file, so the importer sees none of it. `bun run` reads the object there.
// Reference: bun build --compile
import { spoil } from "./color";
import { read } from "./reader";
console.log(read());
spoil();
console.log(read());
