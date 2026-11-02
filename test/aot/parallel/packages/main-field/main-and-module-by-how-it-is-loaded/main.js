// Which file of a package with "main" and "module" in its package.json is loaded: docs/compiler/compatibility.mdx, "Packages".
// An executable is bundled. An import takes "module" there and "main" under `bun run`; require() takes "main" in both; and a package that anything in the build
// requires is "main" for every import too. Each way of loading has a package of its own, because one require() decides for the whole build.
// With --aot an executable holds the files that it holds without.
// Reference: bun build --compile
import { which as imported } from "imported";
import { which as exportedAgain } from "./again.mjs";
import { which as bothInOneFile } from "both-in-one-file";
import { which as bothInTwoFiles } from "both-in-two-files";
import { which as requiredInAnotherFile } from "./requires.cjs";
import { which as bothByAnotherPackage } from "both-by-another-package";
import { which as requiredByAnotherPackage } from "requires-it";
import { which as moduleAndIndex } from "module-and-index";
import { which as moduleAlone } from "module-alone";
import { which as withExports } from "with-exports";
import { which as folder } from "./folder";

console.log("import:", imported);
console.log("import():", (await import("imported-by-call")).which);
console.log("export from:", exportedAgain);
console.log("require():", require("required").which);
console.log("import and require() in one file:", bothInOneFile, "|", require("both-in-one-file").which);
console.log("import here, require() in another file:", bothInTwoFiles, "|", requiredInAnotherFile);
console.log("import here, require() in another package:", bothByAnotherPackage, "|", requiredByAnotherPackage);
console.log('import, "module" and an index.js:', moduleAndIndex);
console.log('require(), "module" and an index.js:', require("module-and-index-required").which);
console.log('import, "module" and nothing else:', moduleAlone);
console.log('import, "exports" beside the two:', withExports);
console.log("import of a folder of the program:", folder);
