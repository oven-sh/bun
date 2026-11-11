// A file one folder above the entry point is required under the path in a URL made from import.meta.url.
// In an executable the URL says file:///$bunfs/job.js: `..` takes a folder away. The module lies in /$bunfs/_.._, and the text was held against its path alone, so the load went to the loader, which refused it.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { fileURLToPath } from "node:url";
console.log(require(fileURLToPath(new URL("../job.js", import.meta.url))).said);
