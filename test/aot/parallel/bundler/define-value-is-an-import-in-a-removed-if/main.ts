// A `--define` whose value is one name is a use of the import of that name, also in an `if` that does nothing: the import keeps the name, and the program ends with a SyntaxError where its module has run and exports no such name, as it does where the name itself is written. `bun run` removes the `if`, drops the name from the import and runs to the end. Plain Bun prints another output.
// Flags: --define NAME=holder
import { holder } from "./lib.cjs";
declare const NAME: any;
if (NAME) {
}
console.log("end");
/* Output:
lib loaded
exit code 1
SyntaxError: Export named 'holder' not found in module '/$bunfs/root/lib.cjs'.
*/
