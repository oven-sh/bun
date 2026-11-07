// fs.readFile, fs.writeFile and fs.appendFile given a `signal` that is no AbortSignal: an object of the program that has `aborted`.
// Native code looks for the property, keeps the object of a call that is not sync, and reads `aborted` and `reason` before the
// operation is scheduled and once more when it completes: later than the call.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "signal-objects-"));
const file = path.join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const describe = error => [error.name, error.code, String(error.cause)].join(" ");
const log = [];

// The sync forms look for `aborted` and read nothing.
const neverRead = {
  get aborted() {
    log.push("a sync form has read `aborted`");
    return true;
  },
};
log.push(fs.readFileSync(file, { encoding: "utf8", signal: neverRead }));
fs.appendFileSync(file, " there", { signal: neverRead });
try {
  fs.readFileSync(file, { signal: { reason: "has no aborted" } });
} catch (error) {
  log.push(error.code, error.message);
}

// Only the getter says that the signal is aborted, and only from the read that the test names on.
class Signal {
  reads = 0;
  constructor(abortedFrom) {
    this.abortedFrom = abortedFrom;
  }
  get aborted() {
    return ++this.reads >= this.abortedFrom;
  }
  get reason() {
    return "read " + this.reads;
  }
}

const never = new Signal(Infinity);
log.push(await fs.promises.readFile(file, { encoding: "utf8", signal: never }), never.reads);
const before = new Signal(1);
log.push(await fs.promises.readFile(file, { signal: before }).catch(describe), before.reads);
const atTheEnd = new Signal(2);
log.push(await fs.promises.writeFile(file, "written", { signal: atTheEnd }).catch(describe), atTheEnd.reads);
await fs.promises.appendFile(file, " and appended", { signal: { aborted: false } });
log.push(fs.readFileSync(file, "utf8"));

const forCallback = new Signal(2);
await new Promise(resolve =>
  fs.readFile(file, { encoding: "utf8", signal: forCallback }, (error, data) => {
    log.push(describe(error), String(data), forCallback.reads);
    resolve();
  }),
);

fs.rmSync(folder, { recursive: true, force: true });
console.log(log.join("\n"));
