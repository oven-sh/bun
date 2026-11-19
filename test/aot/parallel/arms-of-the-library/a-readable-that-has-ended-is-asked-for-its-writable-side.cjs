const EventEmitter = require("node:events");
const { Readable, Stream } = require("node:stream");

const said = [];
const say = (...words) => said.push(words.map(String).join(" "));
process.on("uncaughtException", error => say("  thrown past the tick:", error.constructor.name));

const turns = count =>
  new Promise(done =>
    (function turn(left) {
      left ? setImmediate(turn, left - 1) : done();
    })(count),
  );
const isMark = name => /AutoDestroyed/.test(String(name));
const marks = stream => Object.getOwnPropertySymbols(stream).filter(isMark).length;
const watch = (holder, name, answer) =>
  Object.defineProperty(holder, name, {
    get() {
      say("  the getter under", name, "runs");
      return answer;
    },
    set(value) {
      say("  the setter under", name, "runs");
    },
    configurable: true,
    enumerable: false,
  });
const asked = stream => (stream.end = () => say("  it is asked to end"));
const between = stream => Object.create(Object.getPrototypeOf(stream));

class Tap extends Readable {
  _read() {
    this.push("one");
    this.push(null);
  }
}
const makers = {
  "what from() makes": () => Readable.from(["one", "two"]),
  "a readable with a read of its own": () =>
    new Readable({
      read() {
        this.push("one");
        this.push(null);
      },
    }),
  "a readable with nothing of its own": () => {
    const stream = new Readable();
    stream.push("one");
    stream.push(null);
    return stream;
  },
  "an heir": () => new Tap(),
};

const quietly = stream =>
  new Promise(done => {
    stream.on("close", done);
    stream.resume();
  });
async function warm(make) {
  for (let turn = 0; turn < 200; turn++) await quietly(make());
}
async function markOf(make) {
  const ended = make();
  await quietly(ended);
  return Object.getOwnPropertySymbols(ended).find(isMark);
}
async function end(name, stream, undo) {
  say(name);
  stream.on("end", () => say("  end"));
  stream.on("close", () => say("  close"));
  stream.on("error", error => say("  error", error.constructor.name));
  stream.resume();
  await turns(6);
  say("  destroyed:", stream.destroyed, "| marks:", marks(stream));
  if (undo) undo();
}

const deeds = [
  ["as it was made", () => {}],
  [
    "that does not destroy itself",
    stream => {
      stream._readableState.autoDestroy = false;
    },
  ],
  [
    "with a writable side stored on it",
    stream => {
      stream.writable = true;
      stream.allowHalfOpen = false;
      asked(stream);
    },
  ],
  [
    "with a writable side that stays half open",
    stream => {
      stream.writable = true;
      stream.allowHalfOpen = true;
      asked(stream);
    },
  ],
  [
    "with a writable side that is off",
    stream => {
      stream.writable = false;
      stream.allowHalfOpen = false;
      asked(stream);
    },
  ],
  [
    "with a getter under writable",
    stream => {
      watch(stream, "writable", false);
    },
  ],
  [
    "with getters under both names",
    stream => {
      watch(stream, "writable", true);
      watch(stream, "allowHalfOpen", true);
    },
  ],
  [
    "with a getter under allowHalfOpen alone",
    stream => {
      watch(stream, "allowHalfOpen", false);
    },
  ],
  [
    "with a state that does not destroy",
    stream => {
      stream._writableState = { autoDestroy: false };
    },
  ],
  [
    "with a state that has not finished",
    stream => {
      stream._writableState = { autoDestroy: true, finished: false, writable: true };
    },
  ],
  [
    "with a state that has finished",
    stream => {
      stream._writableState = { autoDestroy: true, finished: true };
    },
  ],
  [
    "with a state that is not writable",
    stream => {
      stream._writableState = { autoDestroy: true, finished: false, writable: false };
    },
  ],
  [
    "with null under the state",
    stream => {
      stream._writableState = null;
    },
  ],
  [
    "with a getter under the state",
    stream => {
      watch(stream, "_writableState", undefined);
    },
  ],
  [
    "with a getter under the state that hands out one",
    stream => {
      watch(stream, "_writableState", { autoDestroy: false });
    },
  ],
  [
    "with a name of no meaning stored on it",
    stream => {
      stream.madeUp = 1;
    },
  ],
  [
    "with a name stored and deleted",
    stream => {
      stream.writable = true;
      delete stream.writable;
    },
  ],
  [
    "with a destroy of its own",
    stream => {
      stream.destroy = function () {
        say("  its own destroy runs");
        return this;
      };
    },
  ],
  [
    "below an object laid between with a getter under writable",
    stream => {
      Object.setPrototypeOf(stream, watch(between(stream), "writable", false));
    },
  ],
  [
    "below an object laid between with a getter under the state",
    stream => {
      Object.setPrototypeOf(stream, watch(between(stream), "_writableState", { autoDestroy: false }));
    },
  ],
  [
    "below an object laid between with a value under writable",
    stream => {
      Object.setPrototypeOf(stream, Object.assign(between(stream), { writable: true, allowHalfOpen: false }));
      asked(stream);
    },
  ],
  [
    "below an object laid between that holds nothing",
    stream => {
      Object.setPrototypeOf(stream, between(stream));
    },
  ],
  [
    "below a proxy",
    stream => {
      Object.setPrototypeOf(
        stream,
        new Proxy(Object.getPrototypeOf(stream), {
          get(target, name, receiver) {
            if (name === "writable" || name === "_writableState") say("  the proxy is asked for", name);
            return Reflect.get(target, name, receiver);
          },
        }),
      );
    },
  ],
  [
    "that takes no more names from its end on",
    stream => {
      stream.on("end", () => Object.preventExtensions(stream));
    },
  ],
  [
    "that is frozen at its end",
    stream => {
      stream.on("end", () => Object.freeze(stream));
    },
  ],
  [
    "that takes no more names from its birth on",
    stream => {
      stream.on("madeUp", () => {});
      Object.preventExtensions(stream);
    },
  ],
  [
    "with a setter under the mark",
    (stream, mark) => {
      Object.defineProperty(stream, mark, {
        set(value) {
          say("  the setter under the mark runs with", value);
        },
        configurable: true,
      });
    },
  ],
  [
    "with a mark that cannot be written",
    (stream, mark) => {
      Object.defineProperty(stream, mark, { value: "laid", writable: false, configurable: true });
    },
  ],
  [
    "with a mark stored ahead",
    (stream, mark) => {
      stream[mark] = "ahead";
      stream.on("close", () => say("  under the mark lies", stream[mark]));
    },
  ],
  [
    "that gets a writable side from a listener of its end",
    stream => {
      stream.on("end", () => {
        stream.writable = true;
        stream.allowHalfOpen = false;
        asked(stream);
      });
    },
  ],
  [
    "that gets a state from a listener of its end",
    stream => {
      stream.on("end", () => (stream._writableState = { autoDestroy: false }));
    },
  ],
  [
    "that gets a getter under writable from a listener of its end",
    stream => {
      stream.on("end", () => watch(stream, "writable", false));
    },
  ],
  [
    "that is laid below another object by a listener of its end",
    stream => {
      stream.on("end", () => Object.setPrototypeOf(stream, watch(between(stream), "writable", false)));
    },
  ],
  [
    "whose listener of its end lays a getter on the prototype of Readable",
    stream => {
      stream.on("end", () => watch(Readable.prototype, "writable", false));
      return () => delete Readable.prototype.writable;
    },
  ],
];
for (const [where, holder] of [
  ["Readable", Readable.prototype],
  ["Stream", Stream.prototype],
  ["EventEmitter", EventEmitter.prototype],
]) {
  for (const [name, value] of [
    ["writable", true],
    ["_writableState", { autoDestroy: false }],
    ["allowHalfOpen", false],
  ]) {
    deeds.push([
      "below a getter under " + name + " on the prototype of " + where,
      () => {
        watch(holder, name, undefined);
        return () => delete holder[name];
      },
    ]);
    deeds.push([
      "below a value under " + name + " on the prototype of " + where,
      stream => {
        holder[name] = value;
        asked(stream);
        return () => delete holder[name];
      },
    ]);
  }
}
deeds.push(
  [
    "below another destroy",
    stream => {
      const kept = Readable.prototype.destroy;
      Readable.prototype.destroy = function (...given) {
        say("  the destroy that was laid on the prototype runs");
        return kept.apply(this, given);
      };
      return () => (Readable.prototype.destroy = kept);
    },
  ],
  [
    "below a setter under the mark on the prototype of Readable",
    (stream, mark) => {
      Object.defineProperty(Readable.prototype, mark, {
        set(value) {
          say("  the setter under the mark runs with", value);
        },
        configurable: true,
      });
      return () => delete Readable.prototype[mark];
    },
  ],
);

(async () => {
  for (const maker in makers) await warm(makers[maker]);
  for (const [name, deed] of deeds) {
    for (const maker in makers) {
      const make = makers[maker];
      const mark = await markOf(make);
      const stream = make();
      await end(maker + " " + name, stream, deed(stream, mark));
      await end(maker + " after that", make());
    }
  }
  console.log(said.join("\n"));
})();
