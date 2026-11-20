// A file below the entry imports the modules and exports functions that read them. Nobody calls the functions: no module of Bun runs.
// COUNT: operation:operationAOTRequireModule = 0
import { read, count } from "./below.mjs";
console.log(typeof read, count);
