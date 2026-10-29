// The importer of a file runs inside the files require of a module that imports the file.
import { second } from "./file.cjs";
console.log("the entry point runs", second);
