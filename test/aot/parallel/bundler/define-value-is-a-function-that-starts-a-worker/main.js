// A `--define` puts a function that starts a Worker with its parameter into an object: the file that a call of the member names is in the executable.
// Flags: --define BEGIN=begin
function begin(file) {
  return new Worker(file);
}
const tools = { start: BEGIN };
const worker = tools.start("./job.js");
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
