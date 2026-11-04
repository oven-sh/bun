// The file of a Worker is named by the `pathname` of a URL that is made of the URL of the file that starts it.
const here = new URL(".", import.meta.url);
const starts = {
  "the folder and a text": () => new Worker(new URL(".", import.meta.url).pathname + "first.mjs"),
  "the file": () => new Worker(new URL("./second.mjs", import.meta.url).pathname),
  "a URL in a variable": () => new Worker(here.pathname + "third.mjs"),
};
for (const [name, start] of Object.entries(starts)) {
  const worker = start();
  const answer = await new Promise(done => {
    worker.onmessage = event => done(event.data);
    worker.onerror = event => (event.preventDefault(), done("error"));
  });
  console.log(name + ":", answer);
  await worker.terminate();
}
