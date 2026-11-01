// A read of a deferred namespace starts the module, which calls import() on the module that reads it. The read takes no step of the loader, so the import() is loaded in later jobs, when the reader has run.
import { loaded } from "./reader.mjs";
console.log("main begins");
loaded.then(answer => console.log("import()", answer));
let jobs = Promise.resolve();
for (let job = 1; job <= 8; job++) jobs = jobs.then(() => console.log("job", job));
