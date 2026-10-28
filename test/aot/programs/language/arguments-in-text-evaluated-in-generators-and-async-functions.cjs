// Text handed to a direct eval in generators, async functions and async generators names `arguments`. Plain Bun prints another output.
const texts = [
  "typeof arguments",
  "arguments.length",
  "arguments[0]",
  "arguments[1]",
  "(arguments[0] = 9, a)",
  "(a = 9, arguments[0])",
  "(arguments[5] = 9, arguments.length)",
  "(arguments.length = 0, arguments.length)",
  "(delete arguments[0], a = 5, arguments[0])",
  "typeof arguments.callee",
  "Object.prototype.toString.call(arguments)",
  "[...arguments].join()",
  "Object.keys(arguments).join()",
  "(() => arguments.length)()",
  "(() => (arguments[0] = 9, a))()",
  "(function () { return arguments.length; })(1, 2, 3)",
  "eval('arguments.length')",
  "(arguments = 4, arguments)",
  "var arguments = 4; arguments",
  "arguments === arguments",
];

const valueOfStep = step => step.value;
const places = [
  [
    "generator function",
    text =>
      (function* (a, b) {
        yield [eval(text), a];
      })(1, 2).next().value,
  ],
  [
    "generator function without parameters",
    text =>
      (function* () {
        yield eval(text);
      })(1, 2).next().value,
  ],
  [
    "generator declaration",
    text => {
      function* steps(a, b) {
        yield [eval(text), a];
      }
      return steps(1, 2).next().value;
    },
  ],
  [
    "generator function with a default",
    text =>
      (function* (a, b = 3) {
        yield [eval(text), a];
      })(1, 2).next().value,
  ],
  [
    "generator function that names arguments",
    text =>
      (function* (a, b) {
        yield [eval(text), a, arguments[0], arguments.length];
      })(1, 2).next().value,
  ],
  [
    "generator function, after a yield",
    text => {
      const steps = (function* (a, b) {
        yield 0;
        yield [eval(text), a];
      })(1, 2);
      steps.next();
      return steps.next().value;
    },
  ],
  [
    "generator function, before and after a yield",
    text => {
      const steps = (function* (a, b) {
        yield eval(text);
        yield [eval(text), a];
      })(1, 2);
      steps.next();
      return steps.next().value;
    },
  ],
  [
    "generator function, returned",
    text =>
      (function* (a, b) {
        return [eval(text), a];
      })(1, 2).next().value,
  ],
  [
    "generator function in a function",
    text =>
      (function () {
        return (function* (a, b) {
          yield [eval(text), a];
        })(1, 2).next().value;
      })(7, 8, 9),
  ],
  [
    "generator function in a generator function",
    text =>
      (function* () {
        yield (function* (a, b) {
          yield [eval(text), a];
        })(1, 2).next().value;
      })(7, 8, 9).next().value,
  ],
  [
    "generator function with a variable named arguments",
    text =>
      (function* (a, b) {
        var arguments;
        yield [eval(text), a];
      })(1, 2).next().value,
  ],
  [
    "generator function, in a with",
    text =>
      (function* (a, b) {
        with ({ c: 1 }) yield [eval(text), a];
      })(1, 2).next().value,
  ],
  [
    "arrow in a generator function",
    text =>
      (function* (a, b) {
        yield (() => [eval(text), a])(5);
      })(1, 2).next().value,
  ],
  [
    "generator method",
    text =>
      ({
        *steps(a, b) {
          yield [eval(text), a];
        },
      })
        .steps(1, 2)
        .next().value,
  ],
  [
    "generator method of a class",
    text =>
      new (class {
        *steps(a, b) {
          yield [eval(text), a];
        }
      })()
        .steps(1, 2)
        .next().value,
  ],
  [
    "static generator method of a class",
    text =>
      class {
        static *steps(a, b) {
          yield [eval(text), a];
        }
      }
        .steps(1, 2)
        .next().value,
  ],
  [
    "async function",
    text =>
      (async function (a, b) {
        return [eval(text), a];
      })(1, 2),
  ],
  [
    "async function, after an await",
    text =>
      (async function (a, b) {
        await 0;
        return [eval(text), a];
      })(1, 2),
  ],
  [
    "async function, before an await",
    text =>
      (async function (a, b) {
        const seen = [eval(text), a];
        await 0;
        return seen;
      })(1, 2),
  ],
  [
    "async function, awaited",
    text =>
      (async function (a, b) {
        return [await eval(text), a];
      })(1, 2),
  ],
  [
    "async function that names arguments",
    text =>
      (async function (a, b) {
        await 0;
        return [eval(text), a, arguments[0], arguments.length];
      })(1, 2),
  ],
  [
    "async function in a function",
    text =>
      (function () {
        return (async function (a, b) {
          await 0;
          return [eval(text), a];
        })(1, 2);
      })(7, 8, 9),
  ],
  [
    "async method, after an await",
    text =>
      ({
        async steps(a, b) {
          await 0;
          return [eval(text), a];
        },
      }).steps(1, 2),
  ],
  [
    "async method of a class, after an await",
    text =>
      new (class {
        async steps(a, b) {
          await 0;
          return [eval(text), a];
        }
      })().steps(1, 2),
  ],
  [
    "arrow in an async function, after an await",
    text =>
      (async function (a, b) {
        await 0;
        return (() => [eval(text), a])(5);
      })(1, 2),
  ],
  [
    "async arrow in an async function, after awaits",
    text =>
      (async function (a, b) {
        await 0;
        return (async () => {
          await 0;
          return [eval(text), a];
        })(5);
      })(1, 2),
  ],
  [
    "async generator function",
    text =>
      (async function* (a, b) {
        yield [eval(text), a];
      })(1, 2)
        .next()
        .then(valueOfStep),
  ],
  [
    "async generator function, after an await",
    text =>
      (async function* (a, b) {
        await 0;
        yield [eval(text), a];
      })(1, 2)
        .next()
        .then(valueOfStep),
  ],
  [
    "async generator method",
    text =>
      ({
        async *steps(a, b) {
          yield [eval(text), a];
        },
      })
        .steps(1, 2)
        .next()
        .then(valueOfStep),
  ],
  [
    "async generator method of a class",
    text =>
      new (class {
        async *steps(a, b) {
          yield [eval(text), a];
        }
      })()
        .steps(1, 2)
        .next()
        .then(valueOfStep),
  ],
];

const constantTexts = [
  [
    "generator function",
    () =>
      (function* (a, b) {
        yield [eval("arguments.length"), eval("(arguments[0] = 9, a)"), a];
      })(1, 2).next().value,
  ],
  [
    "generator method of a class",
    () =>
      new (class {
        *steps(a, b) {
          yield [eval("arguments.length"), eval("(arguments[0] = 9, a)"), a];
        }
      })()
        .steps(1, 2)
        .next().value,
  ],
  [
    "async function, after an await",
    () =>
      (async function (a, b) {
        await 0;
        return [eval("arguments.length"), eval("(arguments[0] = 9, a)"), a];
      })(1, 2),
  ],
  [
    "async generator function",
    () =>
      (async function* (a, b) {
        yield [eval("arguments.length"), eval("(arguments[0] = 9, a)"), a];
      })(1, 2)
        .next()
        .then(valueOfStep),
  ],
];

function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

async function say(label, run) {
  let answer;
  try {
    answer = show(await run());
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(label + ": " + answer);
}

(async () => {
  for (const [place, evaluate] of places)
    for (const text of texts) await say(place + " | " + text, () => evaluate(text));
  for (const [place, run] of constantTexts) await say(place + " | constant texts", run);
})();
