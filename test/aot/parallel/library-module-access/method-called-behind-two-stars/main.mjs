// The names of node:os come through two files. The namespace object of the outer one is only the receiver of calls, and to make it runs no getter of node:os.
import * as all from "./outer.mjs";
console.log(typeof all.hostname(), all.own());
