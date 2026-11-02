// ReadableStream.from asks its operand for an async iterator. Nothing in the program names that member of a directory handle.
import fs from "node:fs";
console.log(typeof ReadableStream.from(fs.opendirSync(import.meta.dirname)));
console.log(typeof ReadableStream.from(await fs.promises.opendir(import.meta.dirname)));
