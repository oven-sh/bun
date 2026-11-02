// sort() reads and writes a list of its own without tests of its form or its bounds, because a comparator cannot reach that list.
// Each comparator here tries: through its caller, through a stack trace, by resizing or replacing what it can see, by running code from what it returns.
function objects(length) {
  const list = [];
  let seed = 4242;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    list.push({ rank: (seed >> 8) % 500, order: i });
  }
  return list;
}
function numbers(length, divisor) {
  return objects(length).map(item => item.rank / divisor);
}
const isOrdered = list => list.every((item, index) => index === 0 || list[index - 1].rank <= item.rank);
const report = (label, run) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error.constructor.name, error.message);
  }
};

// Through its caller.
report("caller", () => {
  const seen = [];
  const list = objects(40);
  list.sort(function compare(a, b) {
    if (seen.length < 3) seen.push(typeof compare.caller, compare.caller === null);
    return a.rank - b.rank;
  });
  return seen.join() + " " + isOrdered(list);
});
report("arguments of the caller", () => {
  const list = objects(40);
  let touched = 0;
  list.sort(function compare(a, b) {
    const caller = compare.caller;
    const handed = caller && caller.arguments;
    if (handed) for (const item of handed) if (Array.isArray(item)) ((item.length = 0), touched++);
    return a.rank - b.rank;
  });
  return touched + " " + isOrdered(list);
});
report("arguments.callee", () => {
  const list = objects(20);
  list.sort(function (a, b) {
    const callee = arguments.callee;
    if (callee.caller && callee.caller.caller) callee.caller.caller.arguments;
    return a.rank - b.rank;
  });
  return isOrdered(list);
});

// Through a stack trace.
report("functions of the frames", () => {
  const list = objects(40);
  const before = Error.prepareStackTrace;
  let reached = 0;
  Error.prepareStackTrace = (_, sites) => {
    for (const site of sites) {
      const self = site.getThis();
      const fn = site.getFunction();
      if (Array.isArray(self)) reached++;
      if (typeof fn === "function" && fn.arguments)
        for (const item of fn.arguments) if (Array.isArray(item)) ((item.length = 0), reached++);
    }
    return "";
  };
  try {
    list.sort((a, b) => {
      new Error("x").stack;
      return a.rank - b.rank;
    });
  } finally {
    Error.prepareStackTrace = before;
  }
  return isOrdered(list);
});

// By what it can see: every shape of the list, at each point of the sort.
// How often it was called is left out: plain Bun's count at these lengths moves with the moment its optimizing tier takes over.
const changes = {
  emptied: list => (list.length = 0),
  shortened: list => (list.length = 2),
  grown: list => (list.length = 100000),
  far: list => (list[1000000] = 1),
  pushed: list => list.push({ rank: 0, order: -1 }),
  shifted: list => list.shift(),
  spliced: list => list.splice(1, 5),
  doubles: list => (list[0] = 1.5),
  text: list => (list[0] = "text"),
  frozen: list => Object.freeze(list),
  sealed: list => Object.seal(list),
  fixed: list => Object.preventExtensions(list),
  accessor: list => Object.defineProperty(list, 0, { get: () => ({ rank: 1, order: 0 }), configurable: true }),
  prototype: list => Object.setPrototypeOf(list, null),
  sorted: list => list.sort((a, b) => (a && a.rank) - (b && b.rank)),
};
for (const [name, change] of Object.entries(changes)) {
  for (const when of [1, 5, 30]) {
    for (const length of [4, 9, 70, 200]) {
      report(`${name} ${when} ${length}`, () => {
        const list = objects(length);
        let calls = 0;
        let isChanging = false;
        const answer = Array.prototype.sort.call(list, (a, b) => {
          if (++calls === when && !isChanging) {
            isChanging = true;
            change(list);
            isChanging = false;
          }
          return (a && a.rank) - (b && b.rank);
        });
        return [answer === list, list.length, Object.keys(list).slice(0, 3).join()].join(" ");
      });
    }
  }
}

// The same to lists of numbers, which sort() holds in another form.
for (const [name, change] of Object.entries(changes)) {
  report(`numbers ${name}`, () => {
    const list = numbers(70, 8);
    let calls = 0;
    list.sort((a, b) => {
      if (++calls === 20) change(list);
      return a * 1 - b * 1;
    });
    return list.length;
  });
}

// A comparator is the only one that still holds the elements: sort() keeps them alive alone.
report("the list is emptied and the collector runs", () => {
  const list = objects(300);
  const copy = list.slice();
  let calls = 0;
  const seen = new Set();
  const answer = list.sort((a, b) => {
    if (++calls === 1) {
      copy.length = 0;
      list.length = 0;
      Bun.gc(true);
    } else if (calls % 97 === 0) Bun.gc(false);
    seen.add(a);
    seen.add(b);
    return a.rank - b.rank;
  });
  return [answer.length, seen.size, [...seen].every(item => typeof item.rank === "number")].join(" ");
});
report("young elements in an old list", () => {
  const list = objects(150);
  let calls = 0;
  list.sort((a, b) => {
    if (++calls % 40 === 0) {
      Bun.gc(true);
      for (let i = 0; i < 200; i++) ({ i, text: `${i}` });
    }
    return a.rank - b.rank;
  });
  return isOrdered(list);
});

// What it returns runs code in the middle of the sort.
report("valueOf of the result", () => {
  const list = objects(70);
  list.sort((a, b) => ({
    valueOf() {
      list.length = 0;
      Bun.gc(false);
      return a.rank - b.rank;
    },
  }));
  return list.length;
});
report("result throws", () => {
  objects(70).sort(() => ({
    valueOf() {
      throw new RangeError("from valueOf");
    },
  }));
});
// Elements that run code as they are read, while sort() takes them.
report("a getter shortens the list", () => {
  const list = objects(30);
  Object.defineProperty(list, 3, {
    get() {
      list.length = 10;
      return { rank: 1, order: 3 };
    },
    configurable: true,
  });
  list.sort((a, b) => a.rank - b.rank);
  return list.length;
});
report("a getter grows the list", () => {
  const list = objects(30);
  Object.defineProperty(list, 3, {
    get() {
      for (let i = 0; i < 100; i++) list.push({ rank: i, order: 100 + i });
      return { rank: 1, order: 3 };
    },
    configurable: true,
  });
  list.sort((a, b) => a.rank - b.rank);
  return list.length;
});
report("a proxy above the list", () => {
  const list = [3, , 1, , 2];
  Object.setPrototypeOf(
    list,
    new Proxy(Array.prototype, {
      has(target, key) {
        if (key === "1") list.length = 2;
        return Reflect.has(target, key);
      },
    }),
  );
  Array.prototype.sort.call(list, (a, b) => a - b);
  return list.length;
});
// Into itself, and to the end of the stack.
report("the same list sorted inside its sort", () => {
  const list = objects(70);
  let depth = 0;
  const compare = (a, b) => {
    if (depth < 3) {
      depth++;
      list.sort(compare);
      depth--;
    }
    return a.rank - b.rank;
  };
  list.sort(compare);
  return isOrdered(list);
});
report("out of stack inside the comparator", () => {
  const list = objects(70);
  const deep = n => deep(n + 1) + 1;
  list.sort((a, b) => {
    deep(0);
    return a.rank - b.rank;
  });
});
report("sort calls itself until the stack ends", () => {
  const list = objects(9);
  const compare = (a, b) => list.slice().sort(compare) && a.rank - b.rank;
  list.sort(compare);
});
report("a generator as comparator", () => {
  const list = objects(9);
  list.sort(function* () {
    yield 1;
  });
  return list.length;
});
report("a bound comparator", () =>
  isOrdered(
    objects(70).sort(
      function (a, b) {
        return this.by(a) - this.by(b);
      }.bind({ by: item => item.rank }),
    ),
  ),
);
report("toSorted, emptied", () => {
  const list = objects(70);
  const answer = list.toSorted((a, b) => {
    list.length = 0;
    return a.rank - b.rank;
  });
  return [list.length, answer.length, isOrdered(answer)].join(" ");
});
