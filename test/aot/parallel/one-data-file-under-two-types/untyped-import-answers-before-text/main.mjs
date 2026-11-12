// An import without a type has an entry of its own, and require() asks that entry first, whichever import is written first.
import { early } from "./early.cjs";
import text from "./data.json" with { type: "text" };
import * as data from "./data.json";
import note from "./note.txt" with { type: "file" };
import "./side.mjs";
import { read } from "./reader.cjs";
console.log(early());
console.log(typeof text, data.port, typeof note);
console.log(read("./data.json", data), read("./note.txt"));
