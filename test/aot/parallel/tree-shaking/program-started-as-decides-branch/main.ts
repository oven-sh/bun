// import.meta.main and require.main === module are true in the entry point and false in a file it imports. Each branch calls a function that nothing else names.
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
import { fromImported } from "./imported";
import fromCommonJS from "./imported-commonjs.cjs";

function whenMain() { return "main.ts is the entry point"; }
function whenNotMain() { return "main.ts is not the entry point"; }

console.log(import.meta.main ? whenMain() : whenNotMain());
if (!import.meta.main) console.log(whenNotMain());
console.log(fromImported);
console.log(fromCommonJS);
