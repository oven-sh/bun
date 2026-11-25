import { Readable, finished } from "node:stream";

const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
const turns = Number(process.argv[2] ?? 60);
const key = String(process.argv[3] ?? "pipe");
let clean = 0;
for (let turn = 0; turn < turns; turn++) {
  finished(new Readable({ read() {} }), { writable: undefined }, () => {})();
  clean++;
}
const spool = new Readable({ read() {} });
let said = "nothing yet";
finished(
  spool,
  {
    get writable() {
      spool[key] = undefined;
      return undefined;
    },
  },
  error => {
    said = error ? (error.code ?? error.name) : "ended";
  },
);
await settle();
console.log(clean / turns, said);
