// A file that is loaded from disk imports files of the executable by their paths on disk and gets the compiled modules: the same instances, the same functions.
// Flags: --aot-allow-code-from-disk
// Alone: the working directory stands for the folder that it was built in
import * as counter from "./counter.mjs";
import { twice } from "./pairs.mjs";
twice();
globalThis.bumpOfProgram = counter.bump;
await import(Buffer.from("./on-disk.mjs").toString());
console.log("the program sees", counter.count);
