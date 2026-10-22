// verbatimModuleSyntax in a package's own tsconfig.json applies to that package, even when the program's tsconfig.json does not set it.
import { area } from "./inner/index.ts";
console.log(area({ width: 2, height: 3 }));
