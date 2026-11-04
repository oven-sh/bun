// A module of Python's is refused when the program is built, by name.
import json from "python:json";
console.log(json.dumps([1, 2]));
/* Build errors:
error: TS100164: --aot does not support Python yet: "python:json" cannot be imported by a compiled program
*/
