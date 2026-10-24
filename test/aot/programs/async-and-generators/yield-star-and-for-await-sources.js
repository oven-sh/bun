// `yield*` and `for await` over each kind of source the iterator operations tell apart.
const log = (...parts) => console.log(parts.join(" "));

function* numbers() {
  try {
    yield 1;
    yield 2;
  } finally {
    log("numbers finally");
  }
}

function withOwnNext() {
  const generator = numbers();
  const next = generator.next;
  generator.next = function (value) {
    log("own next");
    return next.call(this, value);
  };
  return generator;
}

function* customized() {
  yield "sync";
}
customized.prototype[Symbol.asyncIterator] = function () {
  log("Symbol.asyncIterator");
  let index = 0;
  return {
    next() {
      log("async next");
      return Promise.resolve({ done: index >= 1, value: "async " + index++ });
    },
    return() {
      log("async return");
      return Promise.resolve({});
    },
  };
};

function syncOnly() {
  return {
    [Symbol.iterator]() {
      log("Symbol.iterator");
      let index = 0;
      return {
        next() {
          log("sync next");
          return {
            get done() {
              log("get done");
              return index >= 2;
            },
            get value() {
              log("get value");
              return index++;
            },
          };
        },
        return() {
          log("sync return");
          return {};
        },
      };
    },
  };
}

const sources = [
  ["generator", () => numbers()],
  ["own next", withOwnNext],
  ["prototype with Symbol.asyncIterator", () => customized()],
  ["array", () => [1, Promise.resolve(2)]],
  ["sync iterator only", syncOnly],
  ["number", () => 5],
];

async function* delegateAsync(source) {
  yield* source;
}

function* delegateSync(source) {
  yield* source;
}

async function attempt(label, body) {
  log("--", label);
  try {
    await body();
  } catch (error) {
    log(label, "threw", error instanceof Error ? error.name : String(error));
  }
}

async function main() {
  for (const [name, create] of sources) {
    await attempt("sync yield* over " + name, () => {
      for (const value of delegateSync(create())) log("value", value instanceof Promise ? "promise" : value);
    });
    await attempt("async yield* over " + name, async () => {
      for await (const value of delegateAsync(create())) log("value", value);
    });
    await attempt("for await over " + name, async () => {
      for await (const value of create()) log("value", value);
    });
    await attempt("for await with break over " + name, async () => {
      for await (const value of create()) {
        log("value", value);
        break;
      }
    });
  }

  await attempt("Symbol.asyncIterator is not callable", async () => {
    for await (const value of { [Symbol.asyncIterator]: 5 }) log("value", value);
  });
  await attempt("Symbol.asyncIterator returns a primitive", async () => {
    for await (const value of { [Symbol.asyncIterator]: () => 5 }) log("value", value);
  });
  await attempt("Symbol.iterator returns a primitive under yield*", () => {
    for (const value of delegateSync({ [Symbol.iterator]: () => 5 })) log("value", value);
  });

  await attempt("unmodified generators", async () => {
    async function* asyncNumbers() {
      yield 1;
      yield 2;
    }
    const values = [];
    for (const value of delegateSync(numbers())) values.push(value);
    for await (const value of delegateAsync(asyncNumbers())) values.push(value);
    for await (const value of asyncNumbers()) values.push(value);
    for await (const value of numbers()) values.push(value);
    log(values.join());
  });
}

main();
