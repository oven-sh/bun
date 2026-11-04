console.log("the file runs behind", globalThis.jobs, "jobs");
export let state = "runs";
let row = Promise.resolve();
for (let i = 0; i < 40; i++) row = row.then(() => void globalThis.jobsBehindTheFile++);
globalThis.hasItself = import("./self.mjs").then(self => {
  console.log("the file has itself:", self.state, "|", globalThis.jobsBehindTheFile, "jobs behind the file");
});
state = "has run";
