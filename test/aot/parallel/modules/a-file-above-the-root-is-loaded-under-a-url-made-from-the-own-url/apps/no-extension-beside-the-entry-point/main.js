// A file beside the entry point is imported under the href of a URL that leaves its extension out: the loader of `bun run` adds it, and a URL does not.
// The text was held against the URL of the module alone, which has the extension, so the load went to the loader, which refused it.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log((await import(new URL("./beside", import.meta.url).href)).said);
