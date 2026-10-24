// A `var` that function declarations capture lives in an environment and starts as undefined. Whoever reads it in front of its store sees that undefined; where nobody can, the compiler may forget it.
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error.constructor.name, error.message);
  }
}

function storedFirst(n) {
  var box = { x: n };
  var flag = n > 0;
  return read;
  function read() {
    return flag ? box.x : -1;
  }
}
attempt("stored first", () => [storedFirst(1)(), storedFirst(0)()]);

function readFirst(n) {
  var early = read();
  var box = { x: n };
  return [early, read()];
  function read() {
    return box === undefined ? "undefined" : box.x;
  }
}
attempt("read first", () => readFirst(2));

function handedOutFirst(take, n) {
  take(read);
  var box = { x: n };
  return read();
  function read() {
    return typeof box;
  }
}
attempt("handed out first", () => {
  let seen;
  const last = handedOutFirst(read => (seen = read()), 3);
  return [seen, last];
});

function skippedByThrow(fail) {
  try {
    var box = make();
  } catch {
    return read();
  }
  return read();
  function make() {
    if (fail) throw new Error("no box");
    return { x: 4 };
  }
  function read() {
    return box === undefined ? "undefined" : box.x;
  }
}
attempt("skipped by a throw", () => [skippedByThrow(true), skippedByThrow(false)]);

function skippedByBranch(stores) {
  if (stores) var box = { x: 5 };
  return read();
  function read() {
    return box?.x;
  }
}
attempt("skipped by a branch", () => [skippedByBranch(true), skippedByBranch(false)]);

function clearedAgain(n) {
  var box = { x: n };
  var first = read();
  box = undefined;
  return [first, read()];
  function read() {
    return box === undefined ? "undefined" : box.x;
  }
}
attempt("cleared again", () => clearedAgain(6));

function storedUndefined(value) {
  var held = value;
  return read;
  function read() {
    return held === undefined ? "undefined" : typeof held;
  }
}
attempt("stored undefined", () => [storedUndefined(undefined)(), storedUndefined(7)(), storedUndefined()()]);

function oneForEachRound(count) {
  const readers = [];
  for (let i = 0; i < count; i++) {
    readers.push(round(i));
  }
  return readers.map(read => read());
  function round(i) {
    var mine = i * 2;
    return read;
    function read() {
      return mine;
    }
  }
}
attempt("one for each round", () => oneForEachRound(4));

function declaredTwice(n) {
  var box = { x: n };
  var first = read();
  var box;
  var second = read();
  var box = { x: n + 1 };
  return [first, second, read()];
  function read() {
    return box.x;
  }
}
attempt("declared twice", () => declaredTwice(8));

function storedByTheClosure() {
  var count;
  bump();
  bump();
  return count;
  function bump() {
    count = (count ?? 10) + 1;
  }
}
attempt("stored by the closure", storedByTheClosure);

function* suspended(n) {
  yield read();
  var box = { x: n };
  yield read();
  function read() {
    return box === undefined ? "undefined" : box.x;
  }
}
attempt("suspended", () => [...suspended(9)]);

function entersItself(depth) {
  var mine = depth;
  var below = depth > 0 ? entersItself(depth - 1) : [];
  return [read(), ...below];
  function read() {
    return mine;
  }
}
attempt("enters itself", () => entersItself(3));

function namedByText(n) {
  var box = { x: n };
  return eval("read()") + eval("box.x");
  function read() {
    return box.x;
  }
}
attempt("named by text", () => namedByText(10));
