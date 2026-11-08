// A file two folders above the entry point is imported under what import.meta.resolve answers, which joins a path to the URL of the file.
// In an executable the URL says file:///job.js: `..` takes a folder away. The module lies in /$bunfs/_.._, and the text was held against its path alone, so the load went to the loader, which refused it.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log((await import(import.meta.resolve("../../job.js"))).said);
