// A `--define` whose value is one name reads the import of that name from another TypeScript file, which nothing else in the importing file uses: the import stays and the file that exports it runs.
// Flags: --define NAME=named
import { named } from "./exports";
declare const NAME: string;
console.log(NAME);
