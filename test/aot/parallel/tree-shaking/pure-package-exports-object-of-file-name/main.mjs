// A file of a package that says "sideEffects": false exports the object of another file under a name. The import of that name is used, so the file that has the statement is evaluated, as with any name that is handed on; a file that hands it on with `export *` is passed.
// Reference: bun build --compile
import { inner as first } from "named-star";
import { inner as second } from "two-steps";
import { inner as third } from "past-a-star";
console.log(first.beside(), second.beside(), Object.keys(third).join());
