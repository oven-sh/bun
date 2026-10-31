// A stack trace that is taken in a listener of "error", in one of errorMonitor, or off the error that emit("error") throws shows the same functions of node:events as under `bun run`.
const { EventEmitter, errorMonitor } = require("node:events");
const { Readable } = require("node:stream");

const lines = [];
function frames(stack) {
  const names = stack
    .split("\n")
    .slice(1)
    .map(line => line.trim())
    .filter(line => /^at [A-Za-z]/.test(line))
    .map(line => (/\((node|internal):/.test(line) ? line.replace(/:\d+:\d+\)$/, ")") : line.replace(/ \(.*$/, "")));
  // Down to the function of this file that emitted, or to the function of a stream that did.
  const end = names.findIndex(
    (name, at) => at > 1 && !/\(node:events\)$/.test(name) && !/^at (say|heard|watched|second)$/.test(name),
  );
  return names.slice(0, end + 1).join(" < ");
}
const say = label => lines.push(label + ": " + frames(new Error("here").stack));

function oneListener() {
  const emitter = new EventEmitter();
  emitter.on("error", function heard() {
    say("one listener");
  });
  emitter.emit("error", new Error("reset"));
}
function twoListeners() {
  const emitter = new EventEmitter();
  emitter.on("error", function first() {});
  emitter.on("error", function second() {
    say("second of two listeners");
  });
  emitter.emit("error", new Error("reset"));
}
function noArgument() {
  const emitter = new EventEmitter();
  emitter.on("error", function heard() {
    say("no argument");
  });
  emitter.emit("error");
}
function fiveArguments() {
  const emitter = new EventEmitter();
  emitter.on("error", function heard() {
    say("five arguments");
  });
  emitter.emit("error", 1, 2, 3, 4, 5);
}
function onceListener() {
  const emitter = new EventEmitter();
  emitter.once("error", function heard() {
    say("once");
  });
  emitter.emit("error", new Error("reset"));
}
function monitored() {
  const emitter = new EventEmitter();
  emitter.on(errorMonitor, function watched() {
    say("listener of errorMonitor");
  });
  emitter.on("error", function heard() {
    say("listener beside one of errorMonitor");
  });
  emitter.emit("error", new Error("reset"));
}
function ofAClass() {
  class Connection extends EventEmitter {
    fail(error) {
      return this.emit("error", error);
    }
  }
  const connection = new Connection();
  connection.on("error", function heard() {
    say("out of a method of a class");
  });
  connection.fail(new Error("reset"));
}
function capturing() {
  const emitter = new EventEmitter({ captureRejections: true });
  emitter.on("error", function heard() {
    say("emitter that captures rejections");
  });
  emitter.emit("error", new Error("reset"));
}
function listenerThrows() {
  const emitter = new EventEmitter();
  emitter.on("error", function heard() {
    throw new Error("thrown in the listener");
  });
  try {
    emitter.emit("error", new Error("reset"));
  } catch (error) {
    lines.push("listener throws: " + frames(error.stack));
  }
}
function nobodyListens() {
  try {
    new EventEmitter().emit("error", 42);
  } catch (error) {
    lines.push("nobody listens: " + error.code + " " + frames(error.stack));
  }
}
function onlyTheMonitorListens() {
  const emitter = new EventEmitter();
  emitter.on(errorMonitor, function watched() {
    say("listener of errorMonitor alone");
  });
  try {
    emitter.emit("error", 42);
  } catch (error) {
    lines.push("only errorMonitor listens: " + error.code + " " + frames(error.stack));
  }
}
function otherEvent() {
  const emitter = new EventEmitter();
  emitter.on("data", function heard() {
    say("another event, one listener");
  });
  emitter.emit("data", 1);
  emitter.on("data", function second() {
    say("another event, second of two");
  });
  emitter.emit("data", 1);
}
function destroyedStream(done) {
  const stream = new Readable({ read() {} });
  stream.on("error", function heard() {
    say("a stream that is destroyed");
    done();
  });
  stream.destroy(new Error("reset"));
}

for (let round = 0; round < 2; round++) {
  oneListener();
  twoListeners();
  noArgument();
  fiveArguments();
  onceListener();
  monitored();
  ofAClass();
  capturing();
  listenerThrows();
  nobodyListens();
  onlyTheMonitorListens();
  otherEvent();
}
destroyedStream(() => console.log(lines.join("\n")));
