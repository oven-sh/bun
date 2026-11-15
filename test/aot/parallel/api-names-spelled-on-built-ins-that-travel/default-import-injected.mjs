import childProcess from "node:child_process";
class Runner {
  constructor(cp) {
    this.cp = cp;
  }
  run() {
    return this.cp.spawnSync("echo", ["ran"]).stdout.toString().trim();
  }
}
console.log(new Runner(childProcess).run());
