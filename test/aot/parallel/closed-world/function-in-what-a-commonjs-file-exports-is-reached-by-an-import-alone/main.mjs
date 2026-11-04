// Only the objects say which names the two files export, so the run time takes the names out of them and nothing in the program reads "one", "two" or "three".
// What a file exports is in the hands of the run time as soon as the file runs, also where only the import of an ES module leads to the file.
import { one, two } from "./lib.cjs";
import { three } from "./whole.cjs";
console.log(one(), two(), three());
