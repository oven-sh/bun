// A name that node:path lacks stops the entry at its link: neither the file that it imports in front nor its own body runs.
// Exit code: 1
import "./first.mjs";
import { nope } from "node:path";
console.log("the entry runs", typeof nope);
