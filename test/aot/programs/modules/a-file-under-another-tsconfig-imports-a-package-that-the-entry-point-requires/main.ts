// The package names one file for `import` and another for `require`. Where a program does both, both get the file for `require`, also in a file under a tsconfig.json with other compiler options, from which no `require` of the package is reached.
import { kindByName, kindByNamespace, kindOfOther } from "./strict/importer.ts";

const required: { kind: string } = require("two-files");
console.log(required.kind, kindByName(), kindByNamespace(), kindOfOther());
