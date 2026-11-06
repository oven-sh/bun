// An index file that only hands on names of other files, in a package whose package.json says "sideEffects": false, under --ignore-dce-annotations.
// The bundler still loads only the files behind the names that an import names, and all of them for `import *`. With the flag every file that it has loaded runs,
// whether or not the name is used. Each form has a package of its own. With --aot an executable runs the files that it runs without.
// Flags: --ignore-dce-annotations
// Reference: bun build --compile
import { a as used } from "name-used";
import { a as unused } from "name-unused";
import { a as unusedOfOneThatPrints } from "prints-and-name-unused";
import "bare";
import * as readByMember from "member-of-namespace";
import * as unusedNamespace from "namespace-unused";
import { a as behindStars } from "stars";

console.log("the program begins", used, readByMember.a, behindStars);
console.log((await import("member-of-import-call")).a);
console.log(require("member-of-require").a);
console.log("the program ends");
