// With --main-fields an import takes the first of the named fields that the package has, so with "main" first an executable loads the file that `bun run` loads:
// docs/compiler/compatibility.mdx, "Packages". A package that has only "module" is still found.
// Flags: --main-fields main --main-fields module
import { which as both } from "both";
import { which as moduleAlone } from "module-alone";

console.log(both);
console.log(moduleAlone);
