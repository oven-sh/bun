// Behind a test for the dead zone that has passed, the binding is out of it for good. Behind one that threw and was caught it is not.
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error.constructor.name);
  }
}

function readTwice() {
  let first = "nothing";
  try {
    first = changing;
  } catch (error) {
    first = error.constructor.name;
  }
  return first + " then " + changing;
}
function storeThenRead(value) {
  try {
    changing = value;
  } catch (error) {
    console.log("the store threw", error.constructor.name);
  }
  return changing;
}
function readInFinally() {
  try {
    return changing;
  } finally {
    attempt("in finally", () => changing);
  }
}
function readOnOnePath(early) {
  if (early) console.log("one path", changing);
  return changing;
}
attempt("read twice, early", readTwice);
attempt("store then read, early", () => storeThenRead(1));
attempt("finally, early", readInFinally);
attempt("one path, early", () => readOnOnePath(false));
let changing = 10;
attempt("read twice", readTwice);
attempt("store then read", () => storeThenRead(20));
changing += 1;
attempt("finally", readInFinally);
attempt("one path", () => readOnOnePath(true));

function reads(times) {
  let sum = 0;
  for (let i = 0; i < times; i++) {
    sum += changing;
    changing++;
    sum += changing;
  }
  return sum;
}
console.log("in a loop", reads(3), changing);

// The same for a binding that closures share: each call of the outer function has one of its own.
function outer(early) {
  const twice = () => {
    let first = "nothing";
    try {
      first = shared;
    } catch (error) {
      first = error.constructor.name;
    }
    return first + " then " + shared;
  };
  const both = other => shared + " and " + other();
  if (early) attempt("shared, early", twice);
  let shared = early ? "first" : "second";
  attempt("shared", twice);
  shared += "!";
  attempt("shared", twice);
  return { both, read: () => shared };
}
const one = outer(true);
const two = outer(false);
console.log(one.both(two.read), "|", two.both(one.read));
