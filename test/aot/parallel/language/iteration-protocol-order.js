// Order of `Symbol.iterator`, `next`, `return`, `done` and `value` in `for..of`.
const log = (...parts) => console.log(parts.join(" "));

function result(name, done, value) {
  return {
    get done() {
      log(name, "get done");
      return done;
    },
    get value() {
      log(name, "get value");
      return value;
    },
  };
}

function iterable(name, count, closeWith) {
  return {
    [Symbol.iterator]() {
      log(name, "Symbol.iterator");
      let index = 0;
      const iterator = {
        next() {
          log(name, "next");
          return index < count ? result(name, false, index++) : result(name, true, undefined);
        },
      };
      if (closeWith) {
        iterator.return = function () {
          log(name, "return");
          return closeWith();
        };
      }
      return iterator;
    },
  };
}

function attempt(label, body) {
  log("--", label);
  try {
    log(label, "completed with", String(body()));
  } catch (error) {
    log(label, "threw", error instanceof Error ? error.name : String(error));
  }
}

const closeNormally = () => ({});

attempt("to the end", () => {
  for (const value of iterable("end", 2, closeNormally)) log("body", value);
});
attempt("break", () => {
  for (const value of iterable("break", 3, closeNormally)) {
    log("body", value);
    break;
  }
});
attempt("return", () => {
  for (const value of iterable("return", 3, closeNormally)) return value + 10;
});
attempt("throw", () => {
  for (const value of iterable("throw", 3, closeNormally)) throw "body error " + value;
});
attempt("labelled continue", () => {
  outer: for (const first of iterable("outer", 2, closeNormally)) {
    for (const second of iterable("inner", 2, closeNormally)) {
      log("body", first, second);
      continue outer;
    }
  }
});
attempt("no return method", () => {
  for (const value of iterable("open", 2)) break;
});

function iteratorWithNext(name, next) {
  return {
    [Symbol.iterator]() {
      log(name, "Symbol.iterator");
      return next;
    },
  };
}

attempt("next is 5", () => {
  for (const value of iteratorWithNext("five", { next: 5 })) log("body", value);
});
attempt("next is undefined", () => {
  for (const value of iteratorWithNext("missing", { next: undefined })) log("body", value);
});
attempt("next is a getter", () => {
  let index = 0;
  const iterator = {
    get next() {
      log("getter", "get next");
      return () => (index++ < 2 ? { done: false, value: index } : { done: true, value: undefined });
    },
  };
  for (const value of iteratorWithNext("getter", iterator)) log("body", value);
});
attempt("next getter throws", () => {
  const iterator = {
    get next() {
      throw "next getter error";
    },
    return() {
      log("must not run");
      return {};
    },
  };
  for (const value of iteratorWithNext("throwing getter", iterator)) log("body", value);
});
for (const bad of [1, undefined, null, "text", true]) {
  attempt("result is " + String(bad), () => {
    const iterator = {
      next: () => bad,
      return() {
        log("must not run");
        return {};
      },
    };
    for (const value of iteratorWithNext("bad result", iterator)) log("body", value);
  });
}
attempt("Symbol.iterator returns a primitive", () => {
  for (const value of iteratorWithNext("primitive", 7)) log("body", value);
});
attempt("Symbol.iterator is not callable", () => {
  for (const value of { [Symbol.iterator]: 1 }) log("body", value);
});
attempt("next throws", () => {
  const iterator = {
    next() {
      throw "next error";
    },
    return() {
      log("must not run");
      return {};
    },
  };
  for (const value of iteratorWithNext("throwing", iterator)) log("body", value);
});
attempt("done getter throws", () => {
  const iterator = {
    next: () => ({
      get done() {
        throw "done error";
      },
    }),
    return() {
      log("must not run");
      return {};
    },
  };
  for (const value of iteratorWithNext("throwing done", iterator)) log("body", value);
});
attempt("value getter throws", () => {
  const iterator = {
    next: () => ({
      done: false,
      get value() {
        throw "value error";
      },
    }),
    return() {
      log("must not run");
      return {};
    },
  };
  for (const value of iteratorWithNext("throwing value", iterator)) log("body", value);
});

const closeThrows = () => {
  throw "return error";
};
const closePrimitive = () => 1;

attempt("return throws under break", () => {
  for (const value of iterable("close throws", 2, closeThrows)) break;
});
attempt("return gives a primitive under break", () => {
  for (const value of iterable("close primitive", 2, closePrimitive)) break;
});
attempt("return throws under throw", () => {
  for (const value of iterable("close throws", 2, closeThrows)) throw "body error";
});
attempt("return gives a primitive under throw", () => {
  for (const value of iterable("close primitive", 2, closePrimitive)) throw "body error";
});
attempt("return is not callable under break", () => {
  const iterator = { next: () => ({ done: false, value: 1 }), return: 5 };
  for (const value of iteratorWithNext("bad return", iterator)) break;
});
attempt("return is not callable under throw", () => {
  const iterator = { next: () => ({ done: false, value: 1 }), return: 5 };
  for (const value of iteratorWithNext("bad return", iterator)) throw "body error";
});
attempt("return is a getter under throw", () => {
  const iterator = {
    next: () => ({ done: false, value: 1 }),
    get return() {
      log("return getter");
      throw "getter error";
    },
  };
  for (const value of iteratorWithNext("getter return", iterator)) throw "body error";
});

attempt("iterator changed between steps", () => {
  let index = 0;
  const iterator = {
    next() {
      log("first next");
      return { done: index++ >= 2, value: index };
    },
  };
  const source = iteratorWithNext("changed", iterator);
  for (const value of source) {
    log("body", value);
    iterator.next = () => {
      log("must not run");
      return { done: true, value: undefined };
    };
    source[Symbol.iterator] = () => {
      log("must not run");
      return iterator;
    };
  }
});
attempt("return added between steps", () => {
  const iterator = { next: () => ({ done: false, value: 1 }) };
  for (const value of iteratorWithNext("added", iterator)) {
    iterator.return = () => {
      log("added return");
      return {};
    };
    break;
  }
});
attempt("one result shape for every step", () => {
  let index = 0;
  const iterator = { next: () => ({ value: index, done: index++ >= 3 }) };
  for (const value of iteratorWithNext("plain", iterator)) log("body", value);
});
attempt("result shape changes between steps", () => {
  let index = 0;
  const results = [
    { done: false, value: "data" },
    { value: "reversed", done: false },
    result("accessors", false, "accessor"),
    Object.create({ done: false, value: "inherited" }),
    { done: 1, value: "truthy done" },
  ];
  const iterator = { next: () => results[index++] };
  for (const value of iteratorWithNext("shapes", iterator)) log("body", value);
});

function* numbers() {
  yield 1;
  yield 2;
}

log("-- no protocol lines");
for (const source of [[1, 2], new Map([[1, 2]]), new Set([1, 2]), "ab", numbers()]) {
  const values = [];
  for (const value of source) values.push(String(value));
  log(values.join());
}
for (const value of [1, 2, 3]) {
  log("array break", value);
  break;
}
