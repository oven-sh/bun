// Iterator.prototype.forEach: what it calls, in which order, what it throws and which frames an error lists.
const log = [];
const say = (...w) => log.push(w.join(" "));
const attempt = (name, f) => {
  try {
    say(name, JSON.stringify(f()));
  } catch (e) {
    say(name, "threw", e?.constructor?.name, e?.message ?? String(e));
  }
};
function watched(name, count) {
  let n = 0;
  return {
    __proto__: Iterator.prototype,
    get next() {
      say(name, "get next");
      return function () {
        say(name, "next", arguments.length);
        n++;
        return {
          get done() {
            say(name, "get done");
            return n > count;
          },
          get value() {
            say(name, "get value");
            return n;
          },
        };
      };
    },
    get return() {
      say(name, "get return");
      return function () {
        say(name, "return", arguments.length);
        return {};
      };
    },
  };
}
attempt("sum", () => {
  let s = 0;
  [1, 2, 3]
    .values()
    .map(n => n * 2)
    .forEach((v, k) => {
      s += v * 10 + k;
    });
  return s;
});
attempt("this and arguments", () => {
  const seen = [];
  [7].values().forEach(function () {
    "use strict";
    seen.push(this === undefined, arguments.length);
  });
  return seen;
});
attempt("watched", () => watched("a", 2).forEach(v => say("item", v)));
attempt("callback throws", () =>
  watched("b", 2).forEach(v => {
    throw new RangeError("cb " + v);
  }),
);
attempt("no callback", () => watched("c", 2).forEach());
attempt("no callback, return throws", () =>
  ({
    __proto__: Iterator.prototype,
    next() {},
    return() {
      say("return called");
      throw new Error("from return");
    },
  }).forEach(1),
);
attempt("no callback, return answers a number", () =>
  ({
    __proto__: Iterator.prototype,
    next() {},
    return() {
      return 1;
    },
  }).forEach(null),
);
attempt("callback throws, return throws", () =>
  ({
    __proto__: Iterator.prototype,
    next: () => ({ done: false, value: 1 }),
    return() {
      throw new Error("from return");
    },
  }).forEach(() => {
    throw new RangeError("cb");
  }),
);
for (const receiver of [undefined, null, 1, "t"])
  attempt(`of ${receiver}`, () => Iterator.prototype.forEach.call(receiver, () => {}));
attempt("next is no function", () => Iterator.prototype.forEach.call({ next: 1 }, () => {}));
attempt("result is no object", () =>
  Iterator.prototype.forEach.call(
    {
      next: () => 1,
      return() {
        say("closed");
        return {};
      },
    },
    () => {},
  ),
);
attempt("answer", () => [1].values().forEach(() => 5));
const frames = error =>
  error.stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/[^ (]*[\\/]/, ""))
    .join(" | ");
function thrower() {
  try {
    [1].values().forEach(() => {
      throw new Error("x");
    });
  } catch (e) {
    say(frames(e));
  }
  try {
    [1]
      .values()
      .map(() => {
        throw new Error("y");
      })
      .forEach(() => {});
  } catch (e) {
    say(frames(e));
  }
  try {
    [1].values().forEach(1);
  } catch (e) {
    say(frames(e));
  }
}
thrower();
console.log(log.join("\n"));
