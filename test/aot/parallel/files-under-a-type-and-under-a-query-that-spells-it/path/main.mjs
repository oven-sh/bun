// ?file runs the file, and the type gives its path.
import path from "./part.mjs" with { type: "file" };
import * as code from "./part.mjs?file";
console.log(code.value, typeof path, path.endsWith(".mjs"));
