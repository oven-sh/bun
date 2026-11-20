import { Readable, finished } from "node:stream";

const lines = [];
const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
const turns = Number(process.argv[2] ?? 60);
for (let turn = 0; turn < turns; turn++) {
  for (const name of ["readable", "writable", "signal", "error"]) {
    for (const takes of [false, true]) {
      const spool = new Readable({ read() {} });
      let said = "nothing yet";
      const options = {};
      Object.defineProperty(options, name, {
        get() {
          if (takes) spool.pipe = undefined;
          return undefined;
        },
      });
      finished(spool, options, error => {
        said = error ? (error.code ?? error.name) : "ended";
      });
      await settle();
      lines.push(name + (takes ? " takes pipe away: " : " leaves all as it is: ") + said);
    }
  }
}
console.log(lines.join("\n"));
