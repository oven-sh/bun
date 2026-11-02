// A `--define` whose value is `Buffer.from` calls the member of the import that has the name `Buffer`, not of the global that the program has replaced.
// Flags: --define FROM=Buffer.from
import { Buffer } from "node:buffer";
globalThis.Buffer = { from: () => "the replaced global" };
console.log(String(FROM("ab")));
