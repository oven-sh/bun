// A built-in module written without "node:" may be one of the names that a call chooses from.
const late = process.argv.length > 20;
console.log(import.meta.resolve(late ? "node:os" : "fs"), import.meta.resolve(late ? "fs" : "events"));
for (const name of ["crypto", "path", "node:os"]) console.log(import.meta.resolve(late ? "stream" : name));
