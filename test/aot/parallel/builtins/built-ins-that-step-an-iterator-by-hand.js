// Every observable step of the built-ins that step an iterator by hand: which members are read, in which order, how often, and what is thrown.
const log = [];
function iterable(results, options = {}) {
  return {
    get [Symbol.iterator]() {
      log.push("get @@iterator");
      return function () {
        log.push("call @@iterator");
        if ("iterator" in options) return options.iterator;
        let index = 0;
        return {
          get next() {
            log.push("get next");
            if ("next" in options) return options.next;
            return function () {
              log.push("call next " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length);
              return index < results.length ? results[index++] : { done: true, value: "end" };
            };
          },
          get return() {
            log.push("get return");
            if ("return" in options) return options.return;
            return function () {
              log.push("call return " + arguments.length);
              if (options.returnThrows) throw new Error("from return");
              return "returnResult" in options ? options.returnResult : {};
            };
          },
        };
      };
    },
  };
}
function step(value) {
  return {
    get done() {
      log.push("get done");
      return false;
    },
    get value() {
      log.push("get value");
      return value;
    },
  };
}
function attempt(name, work) {
  log.length = 0;
  let outcome;
  try {
    outcome = "returned " + JSON.stringify(work());
  } catch (error) {
    outcome = "threw " + (error && error.name) + ": " + (error && error.message);
  }
  console.log(name + " | " + outcome + " | " + log.join(", "));
}
const bad = [undefined, null, 1, "text", true, Symbol.iterator, 10n];
const users = {
  "Array.from": items => Array.from(items),
  "Array.from mapped": items => Array.from(items, (value, index) => value + ":" + index),
  "Array.from map throws": items =>
    Array.from(items, () => {
      throw new RangeError("from map");
    }),
  "Array.from frozen target": items =>
    Array.from.call(function () {
      return Object.freeze({});
    }, items),
  "Uint8Array.from": items => Array.prototype.slice.call(Uint8Array.from(items)),
  "Uint8Array.from mapped": items => Array.prototype.slice.call(Uint8Array.from(items, value => value * 2)),
  "Map.groupBy": items => [...Map.groupBy(items, value => value % 2)].map(([key, list]) => key + "=" + list),
  "Map.groupBy throws": items =>
    Map.groupBy(items, () => {
      throw new RangeError("from key");
    }),
  "Object.groupBy": items => Object.groupBy(items, value => value % 2),
  "Object.groupBy throws": items =>
    Object.groupBy(items, () => {
      throw new RangeError("from key");
    }),
  "Object.fromEntries": items => Object.fromEntries(items),
  "new Map": items => [...new Map(items)],
  "new Set": items => [...new Set(items)],
};
for (const [name, use] of Object.entries(users)) {
  const pair = name === "Object.fromEntries" || name === "new Map";
  const values = pair ? [step(["a", 1]), step(["b", 2])] : [step(1), step(2), step(3)];
  attempt(name + ": three steps", () => use(iterable(values)));
  attempt(name + ": nothing", () => use(iterable([])));
  for (const result of bad) attempt(name + ": next answers " + String(result), () => use(iterable([result])));
  for (const iterator of bad)
    attempt(name + ": @@iterator answers " + String(iterator), () => use(iterable(values, { iterator })));
  for (const next of bad) attempt(name + ": next is " + String(next), () => use(iterable(values, { next })));
  attempt(name + ": return is undefined", () => use(iterable(values, { return: undefined })));
  attempt(name + ": return is null", () => use(iterable(values, { return: null })));
  attempt(name + ": return is 1", () => use(iterable(values, { return: 1 })));
  attempt(name + ": return throws", () => use(iterable(values, { returnThrows: true })));
  attempt(name + ": return answers 1", () => use(iterable(values, { returnResult: 1 })));
  attempt(name + ": done throws", () =>
    use(
      iterable([
        {
          get done() {
            throw new EvalError("from done");
          },
        },
      ]),
    ),
  );
  attempt(name + ": value throws", () =>
    use(
      iterable([
        {
          done: false,
          get value() {
            throw new EvalError("from value");
          },
        },
      ]),
    ),
  );
  attempt(name + ": next throws", () =>
    use(
      iterable(values, {
        next() {
          throw new EvalError("from next");
        },
      }),
    ),
  );
  attempt(name + ": a proxy as result", () =>
    use(iterable([new Proxy({ done: false, value: pair ? ["p", 1] : 5 }, {})])),
  );
  attempt(name + ": a function as result", () =>
    use(iterable([Object.assign(function () {}, { done: false, value: pair ? ["f", 1] : 6 })])),
  );
}
