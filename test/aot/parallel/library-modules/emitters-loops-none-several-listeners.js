// emit() called in loops, where the compiler may take its body in: no listener, one, several; no argument up to five; names that are
// written, computed and symbols; listeners that add, remove and throw; "error"; rejections that are captured; receivers that are no emitters.
import { EventEmitter, errorMonitor, captureRejectionSymbol } from "node:events";

const lines = [];
const say = (...parts) =>
  lines.push(parts.map(part => (typeof part === "symbol" ? part.toString() : String(part))).join(" "));

function countsOfArguments() {
  const emitter = new EventEmitter();
  let seen = "";
  emitter.on("none", function () {
    seen += arguments.length + (this === emitter ? "t" : "f");
  });
  emitter.on("one", function (a) {
    seen += arguments.length + ":" + a;
  });
  emitter.on("two", function (a, b) {
    seen += arguments.length + ":" + a + b;
  });
  emitter.on("three", function (a, b, c) {
    seen += arguments.length + ":" + a + b + c;
  });
  emitter.on("four", function (a, b, c, d) {
    seen += arguments.length + ":" + a + b + c + d;
  });
  emitter.on("five", function (...all) {
    seen += all.length + ":" + all.join("");
  });
  let heard = 0;
  for (let i = 0; i < 3; i++) {
    if (emitter.emit("none")) heard++;
    if (emitter.emit("one", i)) heard++;
    if (emitter.emit("two", i, "b")) heard++;
    if (emitter.emit("three", i, "b", undefined)) heard++;
    if (emitter.emit("four", i, null, "c", "d")) heard++;
    if (emitter.emit("five", i, 2, 3, 4, 5)) heard++;
    if (emitter.emit("nobody", i)) heard++;
  }
  say("counts", heard, seen);
}

function severalListeners() {
  const emitter = new EventEmitter();
  let seen = "";
  for (const mark of ["a", "b", "c"])
    emitter.on("tick", function (x, y) {
      seen += mark + arguments.length + (x ?? "-") + (y ?? "-") + (this === emitter ? "" : "!");
    });
  for (let i = 0; i < 2; i++) {
    emitter.emit("tick");
    emitter.emit("tick", i);
    emitter.emit("tick", i, i + 1);
    emitter.emit("tick", i, i + 1, 3, 4, 5, 6);
  }
  say("several", seen);
}

function listenersThatChangeTheList() {
  const emitter = new EventEmitter();
  let seen = "";
  const late = () => {
    seen += "L";
  };
  const first = () => {
    seen += "1";
    emitter.on("tick", late);
  };
  const second = () => {
    seen += "2";
    emitter.off("tick", third);
  };
  const third = () => {
    seen += "3";
  };
  emitter.on("tick", first);
  for (let i = 0; i < 2; i++) {
    emitter.emit("tick");
    seen += "|";
  }
  emitter.removeAllListeners("tick");
  emitter.on("tick", second);
  emitter.on("tick", third);
  for (let i = 0; i < 2; i++) {
    emitter.emit("tick");
    seen += "|";
  }
  emitter.once("only", x => {
    seen += "o" + x;
  });
  for (let i = 0; i < 3; i++) {
    const heard = emitter.emit("only", i);
    seen += heard ? "T" : "F";
  }
  say("changes", seen, emitter.listenerCount("tick"), emitter.listenerCount("only"));
}

function namesOfEveryKind() {
  const emitter = new EventEmitter();
  const key = Symbol("key");
  const names = ["open", "data", key, "4", "__proto__", "constructor", "error"];
  let seen = "";
  for (const name of names)
    emitter.on(name, x => {
      seen += String(typeof name === "symbol" ? "sym" : name) + x + ",";
    });
  for (let i = 0; i < names.length + 2; i++) {
    const heard = emitter.emit(names[i % (names.length + 1)], i);
    if (!heard) seen += "no" + i + ",";
  }
  for (let i = 0; i < 2; i++) {
    const heard = emitter.emit(4, i);
    if (!heard) seen += "number-no,";
  }
  say("names", seen);
}

function errors() {
  const emitter = new EventEmitter();
  for (let i = 0; i < 2; i++) {
    try {
      emitter.emit("error", new RangeError("unheard " + i));
    } catch (error) {
      say("thrown", error.name, error.message);
    }
    try {
      emitter.emit("error", "text " + i);
    } catch (error) {
      say("thrown", error.name, error.code, error.context);
    }
    try {
      emitter.emit("error");
    } catch (error) {
      say("thrown", error.name, error.code, error.context);
    }
  }
  emitter.on(errorMonitor, error => say("monitor", error.message));
  try {
    emitter.emit("error", new Error("monitored"));
  } catch (error) {
    say("thrown", error.message);
  }
  emitter.on("error", (error, more) => say("heard", error.message, more));
  for (let i = 0; i < 2; i++) say("answer", emitter.emit("error", new Error("heard " + i), i));
  emitter.on("tick", x => {
    throw new TypeError("from the listener " + x);
  });
  for (let i = 0; i < 2; i++) {
    try {
      emitter.emit("tick", i);
    } catch (error) {
      say("thrown", error.name, error.message);
    }
  }
  emitter.on("tick", () => say("never reached"));
  for (let i = 0; i < 2; i++) {
    try {
      emitter.emit("tick", i);
    } catch (error) {
      say("thrown", error.name, error.message);
    }
  }
}

function otherReceivers() {
  const emit = EventEmitter.prototype.emit;
  const bare = Object.create(EventEmitter.prototype);
  const plain = {
    _events: {
      tick: function (x) {
        say("plain", x, this === plain);
      },
    },
  };
  const odd = { _events: { tick: 5, list: [x => say("first of a list", x), x => say("second of a list", x)] } };
  for (let i = 0; i < 2; i++) {
    say("bare", bare.emit("tick", i), emit.call({}, "tick", i), emit.call(plain, "tick", i), emit.call(odd, "list", i));
    try {
      say(emit.call(odd, "tick", i));
    } catch (error) {
      say("thrown", error.name);
    }
    try {
      say(emit.call(undefined, "tick", i));
    } catch (error) {
      say("thrown", error.name);
    }
    try {
      say(emit.call(5, "tick", i));
    } catch (error) {
      say("thrown", error.name);
    }
  }
  class Source extends EventEmitter {
    push(chunk) {
      return this.emit("data", chunk, this.constructor.name);
    }
  }
  const source = new Source();
  source.on("data", (chunk, name) => say("source", chunk, name));
  for (let i = 0; i < 2; i++) say(source.push(i));
  source.emit = function (name, ...rest) {
    say("replaced", name, rest.length);
    return "mine";
  };
  for (let i = 0; i < 2; i++) say(source.push(i));
}

async function capturedRejections() {
  const emitter = new EventEmitter({ captureRejections: true });
  emitter.on("error", error => say("captured", error.message));
  emitter.on("one", async (a, b) => {
    throw new Error("one " + a + b);
  });
  emitter.on("many", async a => {
    throw new Error("many first " + a);
  });
  emitter.on("many", async (a, b, c, d, e) => {
    throw new Error("many second " + a + b + c + d + e);
  });
  for (let i = 0; i < 2; i++) {
    emitter.emit("one", i, "x");
    emitter.emit("many", i, 2, 3, 4, 5);
  }
  await new Promise(resolve => setTimeout(resolve, 5));
  const own = new EventEmitter({ captureRejections: true });
  own[captureRejectionSymbol] = (error, name, ...rest) => say("own", error.message, name, rest.length, rest.join("+"));
  own.on("tick", async () => {
    throw new Error("kept");
  });
  for (let i = 0; i < 2; i++) own.emit("tick", i, "second", "third");
  await new Promise(resolve => setTimeout(resolve, 5));
  const thenable = new EventEmitter({ captureRejections: true });
  thenable.on("error", error => say("thenable", error));
  thenable.on("tick", x => ({
    then(resolve, reject) {
      reject("refused " + x);
    },
  }));
  for (let i = 0; i < 2; i++) thenable.emit("tick", i);
  await new Promise(resolve => setTimeout(resolve, 5));
}

countsOfArguments();
severalListeners();
listenersThatChangeTheList();
namesOfEveryKind();
errors();
otherReceivers();
await capturedRejections();
console.log(lines.join("\n"));
