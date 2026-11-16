// Iterator helpers and Iterator.prototype.toArray: what they call, in which order, what they throw and which frames an error lists.
const log = [];
const say = (...words) => log.push(words.join(" "));
const attempt = (name, f) => {
  try {
    say(name, JSON.stringify(f()));
  } catch (error) {
    say(name, "threw", error?.constructor?.name, error?.message ?? String(error));
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

// The chain of the everyday benchmark, and each helper alone.
const numbers = [1, 2, 3, 4, 5, 6, 7, 8];
for (let i = 0; i < 3; i++)
  attempt("chain", () =>
    numbers
      .values()
      .filter(n => n & 1)
      .map(n => n + i)
      .take(2)
      .toArray(),
  );
attempt("drop", () => numbers.values().drop(6).toArray());
attempt("flatMap", () =>
  numbers
    .values()
    .take(2)
    .flatMap(n => [n, -n])
    .toArray(),
);
attempt("of a set", () =>
  new Set("abca")
    .values()
    .map(c => c + c)
    .toArray(),
);
attempt("of a map", () => new Map([[1, 2]]).entries().toArray());
attempt("of a string", () => "añ𝒳"[Symbol.iterator]().toArray());
attempt("of a generator", () =>
  (function* () {
    yield 1;
    yield* [2, 3];
  })().toArray(),
);
attempt("empty", () => [].values().toArray());
attempt("holes and kinds", () => [1, 1.5, "a", , null].values().toArray());

// Order of what a helper and toArray read and call.
attempt("watched toArray", () => watched("a", 2).toArray());
attempt("watched map", () =>
  watched("b", 2)
    .map(n => n * 2)
    .toArray(),
);
attempt("watched take", () => watched("c", 5).take(1).toArray());
attempt("watched take 0", () => watched("d", 5).take(0).toArray());

// Receivers and results that are not what is asked for.
for (const receiver of [undefined, null, 1, "text", Symbol.iterator, 1n])
  attempt(`toArray of ${String(receiver)}`, () => Iterator.prototype.toArray.call(receiver));
attempt("no next", () => Iterator.prototype.toArray.call({}));
attempt("next is no function", () => Iterator.prototype.toArray.call({ next: 1 }));
attempt("result is no object", () => Iterator.prototype.toArray.call({ next: () => 1 }));
attempt("result is a function", () =>
  Iterator.prototype.toArray.call({ next: () => Object.assign(() => {}, { done: true }) }),
);
attempt("next throws", () =>
  Iterator.prototype.toArray.call({
    next() {
      throw new RangeError("from next");
    },
    return() {
      say("closed");
      return {};
    },
  }),
);
attempt("done throws", () =>
  Iterator.prototype.toArray.call({
    next: () => ({
      get done() {
        throw new RangeError("from done");
      },
    }),
    return() {
      say("closed");
      return {};
    },
  }),
);
attempt("value throws", () =>
  Iterator.prototype.toArray.call({
    next: () => ({
      done: false,
      get value() {
        throw new RangeError("from value");
      },
    }),
    return() {
      say("closed");
      return {};
    },
  }),
);
attempt("done is truthy", () => Iterator.prototype.toArray.call({ next: () => ({ done: "yes", value: 1 }) }));
attempt("helper next of another receiver", () =>
  []
    .values()
    .map(n => n)
    .next.call({}),
);
attempt("helper return of another receiver", () =>
  []
    .values()
    .map(n => n)
    .return.call([].values()),
);

// A helper that is running, has not begun, has ended.
{
  let helper;
  helper = numbers.values().map(n => (n === 2 ? helper.next() : n));
  attempt("first", () => helper.next());
  attempt("steps itself", () => helper.next());
  attempt("after the throw", () => helper.next());
}
{
  let helper;
  helper = numbers.values().map(n => (n === 1 ? helper.return() : n));
  attempt("closes itself", () => helper.next());
  attempt("after that", () => helper.next());
}
{
  const helper = watched("e", 3).map(n => n);
  attempt("return at the start", () => helper.return());
  attempt("return again", () => helper.return());
  attempt("next after return", () => helper.next());
}
{
  const helper = watched("f", 3).filter(n => n > 1);
  attempt("next", () => helper.next());
  attempt("return at a yield", () => helper.return());
  attempt("next after return", () => helper.next());
}
{
  const helper = watched("g", 1).map(n => n);
  attempt("to the end", () => [helper.next(), helper.next(), helper.next()]);
  attempt("return at the end", () => helper.return());
}
{
  const helper = watched("h", 3).map(n => {
    throw new RangeError(`mapper ${n}`);
  });
  attempt("mapper throws", () => helper.next());
  attempt("after the mapper threw", () => helper.next());
}

// What a helper is.
{
  const helper = numbers.values().map(n => n);
  const prototype = Object.getPrototypeOf(helper);
  say(
    Object.prototype.toString.call(helper),
    Reflect.ownKeys(helper).length,
    Reflect.ownKeys(prototype).map(String).join(),
  );
  say(
    Object.getPrototypeOf(prototype) === Iterator.prototype,
    helper instanceof Iterator,
    helper[Symbol.iterator]() === helper,
  );
  say(prototype === Object.getPrototypeOf(numbers.values().filter(n => n)), typeof helper.throw);
  helper.next = () => ({ done: true, value: "own next" });
  attempt("own next", () => helper.toArray());
  attempt("for-of with an own next", () => {
    for (const value of helper) return value;
    return "nothing";
  });
}

// The frames of an error.
const frames = error =>
  error.stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/[^ (]*[\\/]/, ""))
    .join(" | ");
function thrower() {
  try {
    numbers
      .values()
      .filter(() => true)
      .map(() => {
        throw new Error("x");
      })
      .take(2)
      .toArray();
  } catch (error) {
    say(frames(error));
  }
  try {
    Iterator.prototype.toArray.call({
      next() {
        throw new Error("n");
      },
    });
  } catch (error) {
    say(frames(error));
  }
  try {
    Iterator.prototype.toArray.call(1);
  } catch (error) {
    say(frames(error));
  }
  try {
    Iterator.prototype.toArray.call({ next: () => 1 });
  } catch (error) {
    say(frames(error));
  }
}
thrower();

// Many elements, so that the list grows and a collection runs.
attempt("long", () => {
  const list = Array.from({ length: 100000 }, (_, k) => k)
    .values()
    .map(k => ({ k }))
    .filter(o => o.k % 3 === 0)
    .toArray();
  return [list.length, list[list.length - 1].k];
});

console.log(log.join("\n"));
