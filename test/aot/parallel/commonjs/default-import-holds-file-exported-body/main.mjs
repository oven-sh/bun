// Each file puts another object in the place of module.exports once its body has ended: in a job, or in a function that the importer calls. A default import holds what the file exported when its body ended.
import inAJob, { count } from "./replaced-in-a-job.cjs";
import byACall from "./replaced-by-a-call.cjs";
import * as namespace from "./replaced-in-a-job.cjs";

console.log(JSON.stringify(inAJob), count, inAJob === namespace.default, typeof byACall.replace);
byACall.replace();
console.log(typeof byACall.replace, JSON.stringify(require("./replaced-by-a-call.cjs")));
setTimeout(() => {
  console.log(JSON.stringify(inAJob), count, inAJob === namespace.default, JSON.stringify(require("./replaced-in-a-job.cjs")));
});
