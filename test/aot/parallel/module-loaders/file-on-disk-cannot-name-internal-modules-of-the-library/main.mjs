// What flow rests on where it keeps the exports of the library's internal modules out of the hands of code that nobody has seen: no name that a file from disk
// can write finds such a module. The file tries every way to ask.
// Plain Bun answers the bare names where Bun's own tests run (--expose-internals, or the variables that stand for it). A process that runs a compiled program does not.
// Flags: --aot-allow-code-from-disk --compile-in-place
import { Readable } from "node:stream";
await (await import(Buffer.from("./on-disk.cjs").toString())).default;
let sum = 0;
for await (const chunk of Readable.from([1, 2, 3])) sum += chunk;
console.log("the program reads", sum, Readable.from([1]).readableFlowing);
/* Output:
require ResolveMessage ResolveMessage ResolveMessage ResolveMessage ResolveMessage ResolveMessage
import ResolveMessage ResolveMessage ResolveMessage ResolveMessage ResolveMessage ResolveMessage
getBuiltinModule undefined undefined undefined undefined undefined undefined
binding Error Error Error Error Error Error
resolve ResolveMessage ResolveMessage ResolveMessage ResolveMessage ResolveMessage ResolveMessage
isBuiltin false false false false false false
listed none
symbols of a state true
the program reads 6 null
*/
