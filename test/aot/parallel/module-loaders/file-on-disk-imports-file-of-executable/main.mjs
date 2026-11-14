// What a file from disk imports beside itself is the file on disk: a second module with its own state, also where its twin was compiled in.
// Reference: bun build --compile
// Flags: --aot-allow-code-from-disk
// Alone: the file on disk is looked for from the working directory
import * as counter from "./counter.mjs";
import { twice } from "./pairs.mjs";
twice();
globalThis.bumpOfProgram = counter.bump;
await import(Buffer.from("./on-disk.mjs").toString());
console.log("the program sees", counter.count);
/* Output:
the file on disk sees 0 false 2 bump,count
the program sees 2
*/
