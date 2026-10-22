const lines = [];

function attempt(name, run) {
  try {
    lines.push(name + " | " + JSON.stringify(run()));
  } catch (error) {
    lines.push(name + " | THROWS " + (error instanceof TypeError ? "TypeError" : error.constructor.name + ": " + error.message));
  }
}

function iterableOver(createIterator) {
  return {
    [Symbol.iterator]() {
      lines.push("Symbol.iterator called");
      return createIterator();
    },
  };
}

function readAll(iterable) {
  const seen = [];
  for (const value of iterable) seen.push(value);
  return seen;
}

function tryEveryForm(name, createIterator) {
  attempt(name + ": for..of", () => readAll(iterableOver(createIterator)));
  attempt(name + ": spread", () => [...iterableOver(createIterator)]);
  attempt(name + ": pattern", () => {
    const [first] = iterableOver(createIterator);
    return [first];
  });
  attempt(name + ": empty pattern", () => {
    const [] = iterableOver(createIterator);
    return "opened";
  });
}

function countTo(limit) {
  let count = 0;
  return () => {
    count++;
    return { done: count > limit, value: count };
  };
}

tryEveryForm("next is 5", () => ({ next: 5 }));
tryEveryForm("next is undefined", () => ({ next: undefined }));
tryEveryForm("next is missing", () => ({}));
tryEveryForm("next is null", () => ({ next: null }));
tryEveryForm("next is text", () => ({ next: "next" }));
tryEveryForm("next is an object", () => ({ next: {} }));

let reads = 0;
tryEveryForm("next is a getter", () => {
  const next = countTo(2);
  return {
    get next() {
      reads++;
      lines.push("next read " + reads);
      return next;
    },
  };
});

tryEveryForm("next changes after the first read", () => {
  let isRead = false;
  const next = countTo(2);
  return {
    get next() {
      if (isRead) return 5;
      isRead = true;
      return next;
    },
  };
});

tryEveryForm("next getter throws", () => ({
  get next() {
    throw new RangeError("next getter");
  },
}));

tryEveryForm("well-behaved iterator", () => ({
  next: countTo(2),
  return() {
    lines.push("return called");
    return {};
  },
}));

console.log(lines.join("\n"));
