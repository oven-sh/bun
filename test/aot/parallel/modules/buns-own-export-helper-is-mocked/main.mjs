// A mock takes the place of the file that defines the helper.
import "./setup.mjs";
import { lay } from "./helpers.mjs";
var names = {};
lay(names, { a: () => 1 });
console.log(Object.keys(names));
