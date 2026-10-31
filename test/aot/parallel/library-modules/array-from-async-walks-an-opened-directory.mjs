// Only a built-in asks a directory handle for its async iterator.
import fs from "node:fs";
const entries = await Array.fromAsync(await fs.promises.opendir(import.meta.dirname));
console.log("entries", entries.length > 0);
