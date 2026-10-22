// An object literal of a JavaScript file takes every name, also where the `strict` tsconfig.json of the program governs the file.
import { own, put, take } from "./own.js";
put("b", 2);
console.log(own("b"), take("b"));
