// An import() of site.mjs is under way: its record is made, and the step that goes on with its load lies among the jobs. The require() comes between two of those steps, behind two empty jobs.
// A synchronous load never runs the jobs, so it takes the steps of the load itself, as `bun <file>` does, and answers.
const emptyJobs = Number(process.argv[2] ?? 2);
setTimeout(() => {
  import("./site.mjs").then(got => console.log("import gave", got.name));
  let turn = Promise.resolve();
  for (let i = 0; i < emptyJobs; i++) turn = turn.then(() => {});
  turn.then(() => {
    try {
      console.log("require gave", require("./site.mjs").name);
    } catch (error) {
      console.log("main caught", error.name);
    }
  });
}, 0);
/* Output:
require gave site
import gave site
*/
