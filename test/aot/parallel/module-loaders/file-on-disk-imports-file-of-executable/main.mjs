// A file that is loaded from disk may not load the files that were compiled into the executable: it has globals, built-in modules, what lies on disk and what the program hands it.
// Flags: --aot-allow-code-from-disk
// Alone: the working directory stands for the folder that it was built in
import * as counter from "./counter.mjs";
import { twice } from "./pairs.mjs";
twice();
globalThis.bumpOfProgram = counter.bump;
await import(Buffer.from("./on-disk.mjs").toString());
console.log("the program sees", counter.count);
/* Output:
exit code 1
error: Cannot load '/$bunfs/root/counter.mjs': code that this executable loads from disk can't load the files that were compiled into it. It can use globals, built-in modules, files and packages on disk, and what the program hands it. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
