// Every load from outside enters the cycle at one file, so the other files of the cycle have run when its statements run.
import { a, describe } from "./first.js";
console.log(a, describe());
