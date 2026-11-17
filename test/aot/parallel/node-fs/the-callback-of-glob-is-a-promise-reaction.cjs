// The callback of fs.glob is the promise reaction itself: a microtask that it queues runs before a tick that it queues, and what it throws is an uncaught exception that does not call it again, where the walk succeeds and where it fails.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "the-callback-of-glob-"));
fs.mkdirSync(path.join(cwd, "sub"));
fs.writeFileSync(path.join(cwd, "sub", "nested.txt"), "");
fs.writeFileSync(path.join(cwd, "file.txt"), "");
process.on("exit", () => fs.rmSync(cwd, { recursive: true }));
process.on("uncaughtException", error => console.log("uncaught:", error.message));

function failingWalk() {
  throw new Error("walk failed");
}

function printsItsOrder(name, pattern, options, next) {
  const order = [];
  fs.glob(pattern, options, (error, matches) => {
    order.push(error ? error.message : matches.join());
    process.nextTick(() => order.push("tick"));
    queueMicrotask(() => order.push("microtask"));
    setImmediate(() => {
      console.log(name + ":", order.join(", "));
      next();
    });
  });
}

function throws(name, pattern, options, next) {
  let calls = 0;
  fs.glob(pattern, options, () => {
    calls++;
    setImmediate(() => {
      console.log("calls of the " + name + " callback that throws:", calls);
      next();
    });
    throw new Error("thrown by the " + name + " callback");
  });
}

// No tick is queued before the first callback: node:fs made the tick queue when it loaded.
printsItsOrder("fulfilled", "*.txt", { cwd }, () =>
  printsItsOrder("rejected", "sub/*.txt", { cwd, exclude: failingWalk }, () =>
    throws("fulfilled", "*.txt", { cwd }, () =>
      throws("rejected", "sub/*.txt", { cwd, exclude: failingWalk }, () => {}),
    ),
  ),
);
