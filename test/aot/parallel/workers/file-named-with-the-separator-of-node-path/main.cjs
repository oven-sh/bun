// The file of a Worker is named by the folder of the file that starts it, the separator of node:path and a text.
const { sep } = require("node:path");
const starts = {
  "a member of the module": () => new Worker(__dirname + require("node:path").sep + "first.cjs"),
  "a name of its own": () => new Worker(__dirname + sep + "second.cjs"),
  "in a template": () => new Worker(`${__dirname}${sep}third.cjs`),
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
