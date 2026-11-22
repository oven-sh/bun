const threads = require("node:worker_threads");
const queue = {
  Worker: class {
    constructor(name) {
      this.name = name;
    }
  },
};
const pick = given => given;
const startWith = given => new given.Worker(__filename);
if (threads.isMainThread) {
  console.log("of the program: " + new (pick(queue).Worker)("emails").name);
  exports.start = () => startWith(threads);
} else threads.parentPort.postMessage("answers from the file itself");
