// Exports of start-up modules: process.stdout is built by a start-up module on the first read; its write calls the callback with nothing or null, and its methods are found under computed names.
class Failure extends Error {
  code = 7;
}

let total = 0;

function afterWrite(error: Failure): void {
  total += error instanceof Failure ? error.code : error === undefined ? 100 : error === null ? 10000 : 1000000;
}

afterWrite(new Failure("own"));
process.stdout.write("", afterWrite as any);
process.stdout.write("", "utf8", afterWrite as any);
const method = ["wri", "te"].join("");
(process.stdout as any)[method]("", afterWrite);
process.stdout.once("finish", afterWrite as any);
total += typeof process.stdout.fd === "number" ? 100000000 : 0;
total += typeof (process.stdout as any).constructor === "function" ? 200000000 : 0;
setTimeout(() => console.log(total > 300000000, total % 100, process.stdout.listenerCount("finish")), 10);
