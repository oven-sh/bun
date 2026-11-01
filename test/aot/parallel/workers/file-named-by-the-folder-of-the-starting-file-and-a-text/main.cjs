// The file of a Worker is named by the folder of the file that starts it and a text behind it: in an executable `__dirname` is where the file lay when it was built.
const folder = __dirname;
const inSteps = folder + "/" + "job.cjs";
const sum = __dirname + "/job.cjs";
const starts = {
  "a sum": () => new Worker(__dirname + "/job.cjs"),
  "a template": () => new Worker(`${__dirname}/job.cjs`),
  "a variable": () => new Worker(sum),
  "two steps": () => new Worker(inSteps),
  "up and down": () => new Worker(__dirname + "/deeper/../job.cjs"),
  "the file's own name": () => new Worker(__filename + "/../job.cjs"),
  "no such file": () => new Worker(__dirname + "/none.cjs"),
};
(async () => {
  for (const [name, start] of Object.entries(starts)) {
    const worker = start();
    const answer = await new Promise(done => {
      worker.onmessage = event => done(event.data);
      worker.onerror = event => (event.preventDefault(), done("error"));
    });
    console.log(name + ":", answer);
    await worker.terminate();
  }
})();
