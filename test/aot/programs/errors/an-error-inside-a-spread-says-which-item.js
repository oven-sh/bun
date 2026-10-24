// An error that is thrown while a spread is evaluated says where: each item of a literal, a call or a construction stands on a line of its own, so the line tells the items apart.
function framesOf(error) {
  return String(error.stack)
    .split("\n")
    .filter(line => line.includes("says-which-item"))
    .map(line => line.trim().replace(/^at /, "").replace(/\(?[^ (]*says-which-item\.js/, "").replace(/\)$/, ""))
    .join(" < ");
}

function report(name, run) {
  try {
    run();
    console.log(name, "did not throw");
  } catch (error) {
    console.log(name, "|", error.constructor.name, "|", error.message, "|", framesOf(error));
  }
}

function failingAt(step) {
  return {
    [Symbol.iterator]() {
      let count = 0;
      return {
        next() {
          if (++count > step) throw new RangeError("step " + count);
          return { done: false, value: count };
        },
      };
    },
  };
}

const withGetter = {
  get broken() {
    throw new EvalError("getter");
  },
};

function take(...all) {
  return all.length;
}

class Point {
  constructor(...all) {
    this.count = all.length;
  }
}

class Above extends Point {
  constructor(first, second) {
    super(
      ...first,
      ...second,
    );
  }
}

const good = [1, 2, 3];
const values = [undefined, null, 1, {}, failingAt(0), failingAt(2)];

for (let round = 0; round < 3; round++) {
  for (const bad of values) {
    const name = bad === undefined ? "undefined" : bad === null ? "null" : typeof bad === "number" ? "number" : Symbol.iterator in bad ? "iterator" : "object";
    report("array second " + name, () => [
      ...good,
      ...bad,
      ...good,
    ]);
    report("array third " + name, () => [
      ...good,
      0,
      ...good,
      ...bad,
    ]);
    report("call first " + name, () =>
      take(
        ...bad,
        ...good,
      ),
    );
    report("call second " + name, () =>
      take(
        ...good,
        ...bad,
      ),
    );
    report("method second " + name, () =>
      Math.max(
        ...good,
        ...bad,
      ),
    );
    report("new second " + name, () =>
      new Point(
        ...good,
        ...bad,
      ),
    );
    report("super second " + name, () => new Above(good, bad));
    report("super first " + name, () => new Above(bad, good));
  }
  report("object second", () => ({
    ...good,
    ...withGetter,
    last: 1,
  }));
  report("object third", () => ({
    first: 1,
    ...{ a: 1 },
    ...withGetter,
  }));
}

// The same inside a small function that a caller takes in, and inside a try of the caller.
function joined(a, b) {
  return [
    ...a,
    ...b,
  ];
}

function outer(a, b) {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    try {
      total += joined(
        a,
        i === 3 ? b : a,
      ).length;
    } catch (error) {
      console.log("inlined |", error.constructor.name, "|", error.message, "|", framesOf(error));
    }
  }
  return total;
}

for (const bad of values) console.log(outer(good, bad));
