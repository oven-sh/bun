// An import without a type has an entry of its own, and require() asks that entry first, whichever import is written first.
// `bun <file>` prints another output in about one run of fifty, by which of its reading threads ends first. The output that it prints otherwise stands here.
import { early } from "./early.cjs";
import text from "./data.json" with { type: "text" };
import * as data from "./data.json";
import note from "./note.txt" with { type: "file" };
import "./side.mjs";
import { read } from "./reader.cjs";
console.log(early());
console.log(typeof text, data.port, typeof note);
console.log(read("./data.json", data), read("./note.txt"));

/* Output:
default,port object false | __esModule,default string false
string 21 string
default,port object true __esModule,default string false
*/
