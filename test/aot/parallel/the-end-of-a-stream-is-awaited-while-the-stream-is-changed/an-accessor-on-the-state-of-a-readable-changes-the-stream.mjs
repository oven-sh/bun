import { Readable, finished } from "node:stream";

const lines = [];
const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
const turns = Number(process.argv[2] ?? 60);
for (let turn = 0; turn < turns; turn++) {
  for (const takes of [false, true]) {
    const spool = new Readable({ autoDestroy: false, emitClose: false, read() {} });
    spool.push(null);
    let asks = 0;
    Object.defineProperty(spool._readableState, "length", {
      configurable: true,
      get() {
        asks++;
        if (takes) spool.pipe = undefined;
        return 0;
      },
      set() {},
    });
    let said = "nothing yet";
    finished(spool, error => {
      said = error ? (error.code ?? error.name) : "ended";
    });
    const atOnce = asks;
    await settle();
    lines.push("length of the state " + (takes ? "takes pipe away: " : "leaves all as it is: ") + said + " . asked " + atOnce);
  }
}
console.log(lines.join("\n"));
