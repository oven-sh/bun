// In an executable a `..` that leaves the folder of the entry point is spelled `_.._`. A real folder of that name beside such an import is a build error that names the two files, not an internal compiler error.
import { a } from "./_.._/a.mjs";
import { b } from "../a.mjs";
console.log(a, b);
/* Build errors:
error: TS100085: Two files would have the path "/$bunfs/root/_.._/a.mjs" in the executable: "_.._/a.mjs" and "../a.mjs". A ".." that leaves the folder of the entry point is written "_.._" there, so no folder beside it can have that name
*/
