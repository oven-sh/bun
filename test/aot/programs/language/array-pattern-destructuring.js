// Array binding patterns over iterators that log every step, arrays that change, and arrays with their own iterator.
const log = (...parts) => console.log(parts.join(" "));
const show = (values) => JSON.stringify(values.map((value) => (value === undefined ? "undefined" : value)));

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

function iterable(name, count, throwAtStep) {
  return {
    [Symbol.iterator]() {
      log(name, "Symbol.iterator");
      let index = 0;
      return {
        next() {
          log(name, "next");
          if (index + 1 === throwAtStep) throw "next error";
          return index < count ? result(name, false, index++) : result(name, true, undefined);
        },
        return() {
          log(name, "return");
          return {};
        },
      };
    },
  };
}

function attempt(label, body) {
  log("--", label);
  try {
    body();
  } catch (error) {
    log(label, "threw", error instanceof Error ? error.name : String(error));
  }
}

for (const count of [0, 1, 2, 5]) {
  attempt("[a, b] of " + count, () => {
    const [a, b] = iterable("pair", count);
    log(show([a, b]));
  });
  attempt("[a, , b, ...r] of " + count, () => {
    const [a, , b, ...r] = iterable("rest", count);
    log(show([a, b]), show(r));
  });
  attempt("[] of " + count, () => {
    const [] = iterable("empty", count);
  });
  attempt("[...r] of " + count, () => {
    const [...r] = iterable("only rest", count);
    log(show(r));
  });
  attempt("assignment of " + count, () => {
    let a;
    let b;
    [a, b] = iterable("assigned", count);
    log(show([a, b]));
  });
}

attempt("next throws at step 2", () => {
  const [a, b] = iterable("throwing", 5, 2);
  log("must not run", a, b);
});
attempt("next throws in the rest", () => {
  const [a, ...r] = iterable("throwing rest", 5, 3);
  log("must not run", a, r);
});
attempt("done at step 1", () => {
  let steps = 0;
  const source = {
    [Symbol.iterator]() {
      return {
        next() {
          log("next", ++steps);
          return { done: steps === 1, value: steps };
        },
        return() {
          log("must not run");
          return {};
        },
      };
    },
  };
  const [a, b, ...r] = source;
  log(show([a, b]), show(r));
});
attempt("return throws", () => {
  const source = {
    [Symbol.iterator]: () => ({
      next: () => ({ done: false, value: 1 }),
      return() {
        log("return");
        throw "return error";
      },
    }),
  };
  const [a] = source;
  log("must not run", a);
});
attempt("return gives a primitive", () => {
  const source = {
    [Symbol.iterator]: () => ({
      next: () => ({ done: false, value: 1 }),
      return() {
        log("return");
        return 1;
      },
    }),
  };
  const [a] = source;
  log("must not run", a);
});
attempt("not iterable", () => {
  const [a] = 5;
  log("must not run", a);
});
attempt("defaults run between steps", () => {
  const [a = log("default a"), b = log("default b")] = iterable("defaults", 1);
  log(show([a, b]));
});

attempt("index getter grows the array", () => {
  const array = [1, 2];
  Object.defineProperty(array, 1, {
    get() {
      log("get 1");
      array.push(3, 4);
      return 2;
    },
  });
  const [a, b, c, ...r] = array;
  log(show([a, b, c]), show(r));
});
attempt("index getter shrinks the array", () => {
  const array = [1, 2, 3, 4];
  Object.defineProperty(array, 1, {
    configurable: true,
    get() {
      log("get 1");
      array.length = 2;
      return 2;
    },
  });
  const [a, b, c, ...r] = array;
  log(show([a, b, c]), show(r));
});
attempt("index getter shrinks below the pattern", () => {
  const array = [1, 2, 3];
  Object.defineProperty(array, 0, {
    configurable: true,
    get() {
      log("get 0");
      array.length = 1;
      return 1;
    },
  });
  const [a, b, ...r] = array;
  log(show([a, b]), show(r));
});
attempt("index getter throws", () => {
  const array = [1, 2];
  Object.defineProperty(array, 0, {
    get() {
      throw "index error";
    },
  });
  const [a] = array;
  log("must not run", a);
});
attempt("holes", () => {
  const [a, b, c, ...r] = [1, , 3, , 5];
  log(show([a, b, c]), show(r), r.length, 0 in r);
});

class Logged extends Array {
  *[Symbol.iterator]() {
    log("subclass iterator");
    try {
      yield "first";
      yield "second";
      yield "third";
    } finally {
      log("subclass finally");
    }
  }
}
attempt("subclass with an iterator", () => {
  const [a, b] = Logged.of(1, 2, 3);
  log(show([a, b]));
});
attempt("subclass in a rest pattern", () => {
  const [a, ...r] = Logged.of(1, 2, 3);
  log(show([a]), show(r), Array.isArray(r), r instanceof Logged);
});
attempt("array with an own iterator", () => {
  const array = [1, 2, 3];
  array[Symbol.iterator] = () => iterable("own", 2)[Symbol.iterator]();
  const [a] = array;
  log(show([a]));
});

attempt("plain arrays", () => {
  const array = [1, 2];
  const [a, b] = array;
  const [c, d, e] = array;
  const [f, ...r] = array;
  log(show([a, b, c, d, e, f]), show(r), r !== array);
});
attempt("collections", () => {
  const [a, b] = new Set([1, 2, 3]);
  const [[key, value], ...entries] = new Map([
    [1, 2],
    [3, 4],
  ]);
  const [first, ...characters] = "a\u{1F600}b";
  function* numbers() {
    try {
      yield 1;
      yield 2;
    } finally {
      log("generator closed");
    }
  }
  const [g] = numbers();
  const [h, ...others] = numbers();
  log(show([a, b, key, value, first, g, h]), show(entries), show(characters), show(others));
});
