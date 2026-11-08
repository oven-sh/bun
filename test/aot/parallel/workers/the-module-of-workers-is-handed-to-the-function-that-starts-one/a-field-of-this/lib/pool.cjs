const threads = require("node:worker_threads");
class Pool {
  constructor(given) {
    this.given = given;
  }
  start() {
    return new this.given.Worker(require.resolve("./job.cjs"));
  }
}
exports.start = () => new Pool(threads).start();
