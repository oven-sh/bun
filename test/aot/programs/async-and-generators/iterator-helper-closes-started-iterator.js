// An iterator helper that has started closes its underlying iterator once: when its return() is called, when a loop over it exits early, and when its callback throws. The result of the underlying return() must be an object, and an error of the callback wins over an error of return().
const log = [];
function underlying(close = () => ({})) {
  let count = 0;
  return {
    __proto__: Iterator.prototype,
    next() {
      log.push("next");
      return { value: ++count, done: false };
    },
    return() {
      log.push("return");
      return close();
    },
  };
}
function attempt(label, run) {
  log.length = 0;
  let outcome;
  try {
    outcome = "gives " + JSON.stringify(run());
  } catch (error) {
    outcome = "throws " + (error instanceof Error ? error.name + ": " + error.message : String(error));
  }
  console.log(label + ": " + outcome + " | " + log.join(" "));
}

const helpers = {
  map: (u, callback = x => x) => u.map(callback),
  filter: (u, callback = () => true) => u.filter(callback),
  flatMap: (u, callback = x => [x]) => u.flatMap(callback),
  take: u => u.take(3),
  drop: u => u.drop(1),
};

for (const [name, create] of Object.entries(helpers)) {
  attempt(name + ", next() then return()", () => {
    const helper = create(underlying());
    helper.next();
    return helper.return();
  });
  attempt(name + ", return() twice, then next()", () => {
    const helper = create(underlying());
    helper.next();
    helper.return();
    return [helper.return(), helper.next()];
  });
  attempt(name + ", break out of a loop", () => {
    for (const x of create(underlying())) break;
  });
  attempt(name + ", return out of a loop", () => {
    for (const x of create(underlying())) return x;
  });
  attempt(name + ", throw out of a loop", () => {
    for (const x of create(underlying())) throw "from the loop";
  });
  attempt(name + ", a pattern shorter than the iterator", () => {
    const [first, second] = create(underlying());
    return [first, second];
  });
  for (const primitive of [undefined, null, 1, "text", true]) {
    attempt(name + ", return() gives " + String(primitive), () => {
      const helper = create(underlying(() => primitive));
      helper.next();
      return helper.return();
    });
  }
  attempt(name + ", return() gives a function", () => {
    const helper = create(underlying(() => function () {}));
    helper.next();
    return helper.return();
  });
  attempt(name + ", return() throws", () => {
    const helper = create(underlying(() => { throw "from return()"; }));
    helper.next();
    return helper.return();
  });
  attempt(name + ", return() throws and a loop breaks", () => {
    for (const x of create(underlying(() => { throw "from return()"; }))) break;
  });
  attempt(name + ", return() throws and a loop throws", () => {
    for (const x of create(underlying(() => { throw "from return()"; }))) throw "from the loop";
  });
}

for (const name of ["map", "filter", "flatMap"]) {
  const fail = () => { throw "from the callback"; };
  attempt(name + ", the callback throws", () => helpers[name](underlying(), fail).next());
  attempt(name + ", the callback throws and return() throws", () => helpers[name](underlying(() => { throw "from return()"; }), fail).next());
  attempt(name + ", the callback throws and return() gives a number", () => helpers[name](underlying(() => 1), fail).next());
  attempt(name + ", the callback throws at the second value", () => {
    const helper = helpers[name](underlying(() => { throw "from return()"; }), x => { if (x === 2) throw "from the callback"; return [x]; });
    return [helper.next(), helper.next()];
  });
  attempt(name + ", next() and return() after the callback threw", () => {
    const helper = helpers[name](underlying(), fail);
    try { helper.next(); } catch {}
    return [helper.next(), helper.return()];
  });
}

attempt("flatMap, return() while an inner iterator is open", () => {
  const helper = underlying().flatMap(() => ({
    [Symbol.iterator]() {
      return { next() { log.push("inner next"); return { value: 0, done: false }; }, return() { log.push("inner return"); return {}; } };
    },
  }));
  helper.next();
  return helper.return();
});
attempt("flatMap, the inner return() throws", () => {
  const helper = underlying().flatMap(() => ({
    [Symbol.iterator]() {
      return { next() { return { value: 0, done: false }; }, return() { log.push("inner return"); throw "from the inner return()"; } };
    },
  }));
  helper.next();
  return helper.return();
});
attempt("flatMap, the callback gives a number", () => underlying(() => { throw "from return()"; }).flatMap(() => 1).next());
attempt("take, the limit is reached", () => {
  const helper = underlying().take(1);
  return [helper.next(), helper.next(), helper.next()];
});
attempt("take, the limit is reached and return() gives a number", () => {
  const helper = underlying(() => 1).take(1);
  helper.next();
  return helper.next();
});
attempt("a chain of helpers", () => {
  const helper = underlying().map(x => x + 1).filter(() => true).take(5).drop(0);
  helper.next();
  return helper.return();
});
attempt("an underlying iterator without return()", () => {
  const helper = { __proto__: Iterator.prototype, next() { log.push("next"); return { value: 1, done: false }; } }.map(x => x);
  helper.next();
  return helper.return();
});
