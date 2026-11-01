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
/* Output:
generator function | typeof arguments: [object, 1]
generator function | arguments.length: [2, 1]
generator function | arguments[0]: [1, 1]
generator function | arguments[1]: [2, 1]
generator function | (arguments[0] = 9, a): [9, 9]
generator function | (a = 9, arguments[0]): [9, 9]
generator function | (arguments[5] = 9, arguments.length): [2, 1]
generator function | (arguments.length = 0, arguments.length): [0, 1]
generator function | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator function | typeof arguments.callee: [function, 1]
generator function | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator function | [...arguments].join(): [1,2, 1]
generator function | Object.keys(arguments).join(): [0,1, 1]
generator function | (() => arguments.length)(): [2, 1]
generator function | (() => (arguments[0] = 9, a))(): [9, 9]
generator function | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator function | eval('arguments.length'): [2, 1]
generator function | (arguments = 4, arguments): [4, 1]
generator function | var arguments = 4; arguments: [4, 1]
generator function | arguments === arguments: [true, 1]
generator function without parameters | typeof arguments: object
generator function without parameters | arguments.length: 2
generator function without parameters | arguments[0]: 1
generator function without parameters | arguments[1]: 2
generator function without parameters | (arguments[0] = 9, a): ReferenceError
generator function without parameters | (a = 9, arguments[0]): 1
generator function without parameters | (arguments[5] = 9, arguments.length): 2
generator function without parameters | (arguments.length = 0, arguments.length): 0
generator function without parameters | (delete arguments[0], a = 5, arguments[0]): undefined
generator function without parameters | typeof arguments.callee: function
generator function without parameters | Object.prototype.toString.call(arguments): [object Arguments]
generator function without parameters | [...arguments].join(): 1,2
generator function without parameters | Object.keys(arguments).join(): 0,1
generator function without parameters | (() => arguments.length)(): 2
generator function without parameters | (() => (arguments[0] = 9, a))(): 5
generator function without parameters | (function () { return arguments.length; })(1, 2, 3): 3
generator function without parameters | eval('arguments.length'): 2
generator function without parameters | (arguments = 4, arguments): 4
generator function without parameters | var arguments = 4; arguments: 4
generator function without parameters | arguments === arguments: true
generator declaration | typeof arguments: [object, 1]
generator declaration | arguments.length: [2, 1]
generator declaration | arguments[0]: [1, 1]
generator declaration | arguments[1]: [2, 1]
generator declaration | (arguments[0] = 9, a): [9, 9]
generator declaration | (a = 9, arguments[0]): [9, 9]
generator declaration | (arguments[5] = 9, arguments.length): [2, 1]
generator declaration | (arguments.length = 0, arguments.length): [0, 1]
generator declaration | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator declaration | typeof arguments.callee: [function, 1]
generator declaration | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator declaration | [...arguments].join(): [1,2, 1]
generator declaration | Object.keys(arguments).join(): [0,1, 1]
generator declaration | (() => arguments.length)(): [2, 1]
generator declaration | (() => (arguments[0] = 9, a))(): [9, 9]
generator declaration | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator declaration | eval('arguments.length'): [2, 1]
generator declaration | (arguments = 4, arguments): [4, 1]
generator declaration | var arguments = 4; arguments: [4, 1]
generator declaration | arguments === arguments: [true, 1]
generator function with a default | typeof arguments: [object, 1]
generator function with a default | arguments.length: [2, 1]
generator function with a default | arguments[0]: [1, 1]
generator function with a default | arguments[1]: [2, 1]
generator function with a default | (arguments[0] = 9, a): [1, 1]
generator function with a default | (a = 9, arguments[0]): [1, 9]
generator function with a default | (arguments[5] = 9, arguments.length): [2, 1]
generator function with a default | (arguments.length = 0, arguments.length): [0, 1]
generator function with a default | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator function with a default | typeof arguments.callee: TypeError
generator function with a default | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator function with a default | [...arguments].join(): [1,2, 1]
generator function with a default | Object.keys(arguments).join(): [0,1, 1]
generator function with a default | (() => arguments.length)(): [2, 1]
generator function with a default | (() => (arguments[0] = 9, a))(): [1, 1]
generator function with a default | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator function with a default | eval('arguments.length'): [2, 1]
generator function with a default | (arguments = 4, arguments): [4, 1]
generator function with a default | var arguments = 4; arguments: [4, 1]
generator function with a default | arguments === arguments: [true, 1]
generator function that names arguments | typeof arguments: [object, 1, 1, 2]
generator function that names arguments | arguments.length: [2, 1, 1, 2]
generator function that names arguments | arguments[0]: [1, 1, 1, 2]
generator function that names arguments | arguments[1]: [2, 1, 1, 2]
generator function that names arguments | (arguments[0] = 9, a): [9, 9, 9, 2]
generator function that names arguments | (a = 9, arguments[0]): [9, 9, 9, 2]
generator function that names arguments | (arguments[5] = 9, arguments.length): [2, 1, 1, 2]
generator function that names arguments | (arguments.length = 0, arguments.length): [0, 1, 1, 0]
generator function that names arguments | (delete arguments[0], a = 5, arguments[0]): [undefined, 5, undefined, 2]
generator function that names arguments | typeof arguments.callee: [function, 1, 1, 2]
generator function that names arguments | Object.prototype.toString.call(arguments): [[object Arguments], 1, 1, 2]
generator function that names arguments | [...arguments].join(): [1,2, 1, 1, 2]
generator function that names arguments | Object.keys(arguments).join(): [0,1, 1, 1, 2]
generator function that names arguments | (() => arguments.length)(): [2, 1, 1, 2]
generator function that names arguments | (() => (arguments[0] = 9, a))(): [9, 9, 9, 2]
generator function that names arguments | (function () { return arguments.length; })(1, 2, 3): [3, 1, 1, 2]
generator function that names arguments | eval('arguments.length'): [2, 1, 1, 2]
generator function that names arguments | (arguments = 4, arguments): [4, 1, undefined, undefined]
generator function that names arguments | var arguments = 4; arguments: [4, 1, undefined, undefined]
generator function that names arguments | arguments === arguments: [true, 1, 1, 2]
generator function, after a yield | typeof arguments: [object, 1]
generator function, after a yield | arguments.length: [2, 1]
generator function, after a yield | arguments[0]: [1, 1]
generator function, after a yield | arguments[1]: [2, 1]
generator function, after a yield | (arguments[0] = 9, a): [9, 9]
generator function, after a yield | (a = 9, arguments[0]): [9, 9]
generator function, after a yield | (arguments[5] = 9, arguments.length): [2, 1]
generator function, after a yield | (arguments.length = 0, arguments.length): [0, 1]
generator function, after a yield | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator function, after a yield | typeof arguments.callee: [function, 1]
generator function, after a yield | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator function, after a yield | [...arguments].join(): [1,2, 1]
generator function, after a yield | Object.keys(arguments).join(): [0,1, 1]
generator function, after a yield | (() => arguments.length)(): [2, 1]
generator function, after a yield | (() => (arguments[0] = 9, a))(): [9, 9]
generator function, after a yield | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator function, after a yield | eval('arguments.length'): [2, 1]
generator function, after a yield | (arguments = 4, arguments): [4, 1]
generator function, after a yield | var arguments = 4; arguments: [4, 1]
generator function, after a yield | arguments === arguments: [true, 1]
generator function, before and after a yield | typeof arguments: [object, 1]
generator function, before and after a yield | arguments.length: [2, 1]
generator function, before and after a yield | arguments[0]: [1, 1]
generator function, before and after a yield | arguments[1]: [2, 1]
generator function, before and after a yield | (arguments[0] = 9, a): [9, 9]
generator function, before and after a yield | (a = 9, arguments[0]): [9, 9]
generator function, before and after a yield | (arguments[5] = 9, arguments.length): [2, 1]
generator function, before and after a yield | (arguments.length = 0, arguments.length): [0, 1]
generator function, before and after a yield | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator function, before and after a yield | typeof arguments.callee: [function, 1]
generator function, before and after a yield | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator function, before and after a yield | [...arguments].join(): [1,2, 1]
generator function, before and after a yield | Object.keys(arguments).join(): [0,1, 1]
generator function, before and after a yield | (() => arguments.length)(): [2, 1]
generator function, before and after a yield | (() => (arguments[0] = 9, a))(): [9, 9]
generator function, before and after a yield | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator function, before and after a yield | eval('arguments.length'): [2, 1]
generator function, before and after a yield | (arguments = 4, arguments): [4, 1]
generator function, before and after a yield | var arguments = 4; arguments: [4, 1]
generator function, before and after a yield | arguments === arguments: [true, 1]
generator function, returned | typeof arguments: [object, 1]
generator function, returned | arguments.length: [2, 1]
generator function, returned | arguments[0]: [1, 1]
generator function, returned | arguments[1]: [2, 1]
generator function, returned | (arguments[0] = 9, a): [9, 9]
generator function, returned | (a = 9, arguments[0]): [9, 9]
generator function, returned | (arguments[5] = 9, arguments.length): [2, 1]
generator function, returned | (arguments.length = 0, arguments.length): [0, 1]
generator function, returned | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator function, returned | typeof arguments.callee: [function, 1]
generator function, returned | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator function, returned | [...arguments].join(): [1,2, 1]
generator function, returned | Object.keys(arguments).join(): [0,1, 1]
generator function, returned | (() => arguments.length)(): [2, 1]
generator function, returned | (() => (arguments[0] = 9, a))(): [9, 9]
generator function, returned | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator function, returned | eval('arguments.length'): [2, 1]
generator function, returned | (arguments = 4, arguments): [4, 1]
generator function, returned | var arguments = 4; arguments: [4, 1]
generator function, returned | arguments === arguments: [true, 1]
generator function in a function | typeof arguments: [object, 1]
generator function in a function | arguments.length: [2, 1]
generator function in a function | arguments[0]: [1, 1]
generator function in a function | arguments[1]: [2, 1]
generator function in a function | (arguments[0] = 9, a): [9, 9]
generator function in a function | (a = 9, arguments[0]): [9, 9]
generator function in a function | (arguments[5] = 9, arguments.length): [2, 1]
generator function in a function | (arguments.length = 0, arguments.length): [0, 1]
generator function in a function | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator function in a function | typeof arguments.callee: [function, 1]
generator function in a function | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator function in a function | [...arguments].join(): [1,2, 1]
generator function in a function | Object.keys(arguments).join(): [0,1, 1]
generator function in a function | (() => arguments.length)(): [2, 1]
generator function in a function | (() => (arguments[0] = 9, a))(): [9, 9]
generator function in a function | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator function in a function | eval('arguments.length'): [2, 1]
generator function in a function | (arguments = 4, arguments): [4, 1]
generator function in a function | var arguments = 4; arguments: [4, 1]
generator function in a function | arguments === arguments: [true, 1]
generator function in a generator function | typeof arguments: [object, 1]
generator function in a generator function | arguments.length: [2, 1]
generator function in a generator function | arguments[0]: [1, 1]
generator function in a generator function | arguments[1]: [2, 1]
generator function in a generator function | (arguments[0] = 9, a): [9, 9]
generator function in a generator function | (a = 9, arguments[0]): [9, 9]
generator function in a generator function | (arguments[5] = 9, arguments.length): [2, 1]
generator function in a generator function | (arguments.length = 0, arguments.length): [0, 1]
generator function in a generator function | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator function in a generator function | typeof arguments.callee: [function, 1]
generator function in a generator function | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator function in a generator function | [...arguments].join(): [1,2, 1]
generator function in a generator function | Object.keys(arguments).join(): [0,1, 1]
generator function in a generator function | (() => arguments.length)(): [2, 1]
generator function in a generator function | (() => (arguments[0] = 9, a))(): [9, 9]
generator function in a generator function | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator function in a generator function | eval('arguments.length'): [2, 1]
generator function in a generator function | (arguments = 4, arguments): [4, 1]
generator function in a generator function | var arguments = 4; arguments: [4, 1]
generator function in a generator function | arguments === arguments: [true, 1]
generator function with a variable named arguments | typeof arguments: [object, 1]
generator function with a variable named arguments | arguments.length: [2, 1]
generator function with a variable named arguments | arguments[0]: [1, 1]
generator function with a variable named arguments | arguments[1]: [2, 1]
generator function with a variable named arguments | (arguments[0] = 9, a): [9, 9]
generator function with a variable named arguments | (a = 9, arguments[0]): [9, 9]
generator function with a variable named arguments | (arguments[5] = 9, arguments.length): [2, 1]
generator function with a variable named arguments | (arguments.length = 0, arguments.length): [0, 1]
generator function with a variable named arguments | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator function with a variable named arguments | typeof arguments.callee: [function, 1]
generator function with a variable named arguments | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator function with a variable named arguments | [...arguments].join(): [1,2, 1]
generator function with a variable named arguments | Object.keys(arguments).join(): [0,1, 1]
generator function with a variable named arguments | (() => arguments.length)(): [2, 1]
generator function with a variable named arguments | (() => (arguments[0] = 9, a))(): [9, 9]
generator function with a variable named arguments | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator function with a variable named arguments | eval('arguments.length'): [2, 1]
generator function with a variable named arguments | (arguments = 4, arguments): [4, 1]
generator function with a variable named arguments | var arguments = 4; arguments: [4, 1]
generator function with a variable named arguments | arguments === arguments: [true, 1]
generator function, in a with | typeof arguments: [object, 1]
generator function, in a with | arguments.length: [2, 1]
generator function, in a with | arguments[0]: [1, 1]
generator function, in a with | arguments[1]: [2, 1]
generator function, in a with | (arguments[0] = 9, a): [9, 9]
generator function, in a with | (a = 9, arguments[0]): [9, 9]
generator function, in a with | (arguments[5] = 9, arguments.length): [2, 1]
generator function, in a with | (arguments.length = 0, arguments.length): [0, 1]
generator function, in a with | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator function, in a with | typeof arguments.callee: [function, 1]
generator function, in a with | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator function, in a with | [...arguments].join(): [1,2, 1]
generator function, in a with | Object.keys(arguments).join(): [0,1, 1]
generator function, in a with | (() => arguments.length)(): [2, 1]
generator function, in a with | (() => (arguments[0] = 9, a))(): [9, 9]
generator function, in a with | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator function, in a with | eval('arguments.length'): [2, 1]
generator function, in a with | (arguments = 4, arguments): [4, 1]
generator function, in a with | var arguments = 4; arguments: [4, 1]
generator function, in a with | arguments === arguments: [true, 1]
arrow in a generator function | typeof arguments: [object, 1]
arrow in a generator function | arguments.length: [2, 1]
arrow in a generator function | arguments[0]: [1, 1]
arrow in a generator function | arguments[1]: [2, 1]
arrow in a generator function | (arguments[0] = 9, a): [9, 9]
arrow in a generator function | (a = 9, arguments[0]): [9, 9]
arrow in a generator function | (arguments[5] = 9, arguments.length): [2, 1]
arrow in a generator function | (arguments.length = 0, arguments.length): [0, 1]
arrow in a generator function | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
arrow in a generator function | typeof arguments.callee: [function, 1]
arrow in a generator function | Object.prototype.toString.call(arguments): [[object Arguments], 1]
arrow in a generator function | [...arguments].join(): [1,2, 1]
arrow in a generator function | Object.keys(arguments).join(): [0,1, 1]
arrow in a generator function | (() => arguments.length)(): [2, 1]
arrow in a generator function | (() => (arguments[0] = 9, a))(): [9, 9]
arrow in a generator function | (function () { return arguments.length; })(1, 2, 3): [3, 1]
arrow in a generator function | eval('arguments.length'): [2, 1]
arrow in a generator function | (arguments = 4, arguments): [4, 1]
arrow in a generator function | var arguments = 4; arguments: [4, 1]
arrow in a generator function | arguments === arguments: [true, 1]
generator method | typeof arguments: [object, 1]
generator method | arguments.length: [2, 1]
generator method | arguments[0]: [1, 1]
generator method | arguments[1]: [2, 1]
generator method | (arguments[0] = 9, a): [9, 9]
generator method | (a = 9, arguments[0]): [9, 9]
generator method | (arguments[5] = 9, arguments.length): [2, 1]
generator method | (arguments.length = 0, arguments.length): [0, 1]
generator method | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator method | typeof arguments.callee: [function, 1]
generator method | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator method | [...arguments].join(): [1,2, 1]
generator method | Object.keys(arguments).join(): [0,1, 1]
generator method | (() => arguments.length)(): [2, 1]
generator method | (() => (arguments[0] = 9, a))(): [9, 9]
generator method | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator method | eval('arguments.length'): [2, 1]
generator method | (arguments = 4, arguments): [4, 1]
generator method | var arguments = 4; arguments: [4, 1]
generator method | arguments === arguments: [true, 1]
generator method of a class | typeof arguments: [object, 1]
generator method of a class | arguments.length: [2, 1]
generator method of a class | arguments[0]: [1, 1]
generator method of a class | arguments[1]: [2, 1]
generator method of a class | (arguments[0] = 9, a): [1, 1]
generator method of a class | (a = 9, arguments[0]): [1, 9]
generator method of a class | (arguments[5] = 9, arguments.length): [2, 1]
generator method of a class | (arguments.length = 0, arguments.length): [0, 1]
generator method of a class | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
generator method of a class | typeof arguments.callee: TypeError
generator method of a class | Object.prototype.toString.call(arguments): [[object Arguments], 1]
generator method of a class | [...arguments].join(): [1,2, 1]
generator method of a class | Object.keys(arguments).join(): [0,1, 1]
generator method of a class | (() => arguments.length)(): [2, 1]
generator method of a class | (() => (arguments[0] = 9, a))(): [1, 1]
generator method of a class | (function () { return arguments.length; })(1, 2, 3): [3, 1]
generator method of a class | eval('arguments.length'): [2, 1]
generator method of a class | (arguments = 4, arguments): SyntaxError
generator method of a class | var arguments = 4; arguments: SyntaxError
generator method of a class | arguments === arguments: [true, 1]
static generator method of a class | typeof arguments: [object, 1]
static generator method of a class | arguments.length: [2, 1]
static generator method of a class | arguments[0]: [1, 1]
static generator method of a class | arguments[1]: [2, 1]
static generator method of a class | (arguments[0] = 9, a): [1, 1]
static generator method of a class | (a = 9, arguments[0]): [1, 9]
static generator method of a class | (arguments[5] = 9, arguments.length): [2, 1]
static generator method of a class | (arguments.length = 0, arguments.length): [0, 1]
static generator method of a class | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
static generator method of a class | typeof arguments.callee: TypeError
static generator method of a class | Object.prototype.toString.call(arguments): [[object Arguments], 1]
static generator method of a class | [...arguments].join(): [1,2, 1]
static generator method of a class | Object.keys(arguments).join(): [0,1, 1]
static generator method of a class | (() => arguments.length)(): [2, 1]
static generator method of a class | (() => (arguments[0] = 9, a))(): [1, 1]
static generator method of a class | (function () { return arguments.length; })(1, 2, 3): [3, 1]
static generator method of a class | eval('arguments.length'): [2, 1]
static generator method of a class | (arguments = 4, arguments): SyntaxError
static generator method of a class | var arguments = 4; arguments: SyntaxError
static generator method of a class | arguments === arguments: [true, 1]
async function | typeof arguments: [object, 1]
async function | arguments.length: [2, 1]
async function | arguments[0]: [1, 1]
async function | arguments[1]: [2, 1]
async function | (arguments[0] = 9, a): [9, 9]
async function | (a = 9, arguments[0]): [9, 9]
async function | (arguments[5] = 9, arguments.length): [2, 1]
async function | (arguments.length = 0, arguments.length): [0, 1]
async function | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async function | typeof arguments.callee: [function, 1]
async function | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async function | [...arguments].join(): [1,2, 1]
async function | Object.keys(arguments).join(): [0,1, 1]
async function | (() => arguments.length)(): [2, 1]
async function | (() => (arguments[0] = 9, a))(): [9, 9]
async function | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async function | eval('arguments.length'): [2, 1]
async function | (arguments = 4, arguments): [4, 1]
async function | var arguments = 4; arguments: [4, 1]
async function | arguments === arguments: [true, 1]
async function, after an await | typeof arguments: [object, 1]
async function, after an await | arguments.length: [2, 1]
async function, after an await | arguments[0]: [1, 1]
async function, after an await | arguments[1]: [2, 1]
async function, after an await | (arguments[0] = 9, a): [9, 9]
async function, after an await | (a = 9, arguments[0]): [9, 9]
async function, after an await | (arguments[5] = 9, arguments.length): [2, 1]
async function, after an await | (arguments.length = 0, arguments.length): [0, 1]
async function, after an await | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async function, after an await | typeof arguments.callee: [function, 1]
async function, after an await | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async function, after an await | [...arguments].join(): [1,2, 1]
async function, after an await | Object.keys(arguments).join(): [0,1, 1]
async function, after an await | (() => arguments.length)(): [2, 1]
async function, after an await | (() => (arguments[0] = 9, a))(): [9, 9]
async function, after an await | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async function, after an await | eval('arguments.length'): [2, 1]
async function, after an await | (arguments = 4, arguments): [4, 1]
async function, after an await | var arguments = 4; arguments: [4, 1]
async function, after an await | arguments === arguments: [true, 1]
async function, before an await | typeof arguments: [object, 1]
async function, before an await | arguments.length: [2, 1]
async function, before an await | arguments[0]: [1, 1]
async function, before an await | arguments[1]: [2, 1]
async function, before an await | (arguments[0] = 9, a): [9, 9]
async function, before an await | (a = 9, arguments[0]): [9, 9]
async function, before an await | (arguments[5] = 9, arguments.length): [2, 1]
async function, before an await | (arguments.length = 0, arguments.length): [0, 1]
async function, before an await | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async function, before an await | typeof arguments.callee: [function, 1]
async function, before an await | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async function, before an await | [...arguments].join(): [1,2, 1]
async function, before an await | Object.keys(arguments).join(): [0,1, 1]
async function, before an await | (() => arguments.length)(): [2, 1]
async function, before an await | (() => (arguments[0] = 9, a))(): [9, 9]
async function, before an await | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async function, before an await | eval('arguments.length'): [2, 1]
async function, before an await | (arguments = 4, arguments): [4, 1]
async function, before an await | var arguments = 4; arguments: [4, 1]
async function, before an await | arguments === arguments: [true, 1]
async function, awaited | typeof arguments: [object, 1]
async function, awaited | arguments.length: [2, 1]
async function, awaited | arguments[0]: [1, 1]
async function, awaited | arguments[1]: [2, 1]
async function, awaited | (arguments[0] = 9, a): [9, 9]
async function, awaited | (a = 9, arguments[0]): [9, 9]
async function, awaited | (arguments[5] = 9, arguments.length): [2, 1]
async function, awaited | (arguments.length = 0, arguments.length): [0, 1]
async function, awaited | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async function, awaited | typeof arguments.callee: [function, 1]
async function, awaited | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async function, awaited | [...arguments].join(): [1,2, 1]
async function, awaited | Object.keys(arguments).join(): [0,1, 1]
async function, awaited | (() => arguments.length)(): [2, 1]
async function, awaited | (() => (arguments[0] = 9, a))(): [9, 9]
async function, awaited | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async function, awaited | eval('arguments.length'): [2, 1]
async function, awaited | (arguments = 4, arguments): [4, 1]
async function, awaited | var arguments = 4; arguments: [4, 1]
async function, awaited | arguments === arguments: [true, 1]
async function that names arguments | typeof arguments: [object, 1, 1, 2]
async function that names arguments | arguments.length: [2, 1, 1, 2]
async function that names arguments | arguments[0]: [1, 1, 1, 2]
async function that names arguments | arguments[1]: [2, 1, 1, 2]
async function that names arguments | (arguments[0] = 9, a): [9, 9, 9, 2]
async function that names arguments | (a = 9, arguments[0]): [9, 9, 9, 2]
async function that names arguments | (arguments[5] = 9, arguments.length): [2, 1, 1, 2]
async function that names arguments | (arguments.length = 0, arguments.length): [0, 1, 1, 0]
async function that names arguments | (delete arguments[0], a = 5, arguments[0]): [undefined, 5, undefined, 2]
async function that names arguments | typeof arguments.callee: [function, 1, 1, 2]
async function that names arguments | Object.prototype.toString.call(arguments): [[object Arguments], 1, 1, 2]
async function that names arguments | [...arguments].join(): [1,2, 1, 1, 2]
async function that names arguments | Object.keys(arguments).join(): [0,1, 1, 1, 2]
async function that names arguments | (() => arguments.length)(): [2, 1, 1, 2]
async function that names arguments | (() => (arguments[0] = 9, a))(): [9, 9, 9, 2]
async function that names arguments | (function () { return arguments.length; })(1, 2, 3): [3, 1, 1, 2]
async function that names arguments | eval('arguments.length'): [2, 1, 1, 2]
async function that names arguments | (arguments = 4, arguments): [4, 1, undefined, undefined]
async function that names arguments | var arguments = 4; arguments: [4, 1, undefined, undefined]
async function that names arguments | arguments === arguments: [true, 1, 1, 2]
async function in a function | typeof arguments: [object, 1]
async function in a function | arguments.length: [2, 1]
async function in a function | arguments[0]: [1, 1]
async function in a function | arguments[1]: [2, 1]
async function in a function | (arguments[0] = 9, a): [9, 9]
async function in a function | (a = 9, arguments[0]): [9, 9]
async function in a function | (arguments[5] = 9, arguments.length): [2, 1]
async function in a function | (arguments.length = 0, arguments.length): [0, 1]
async function in a function | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async function in a function | typeof arguments.callee: [function, 1]
async function in a function | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async function in a function | [...arguments].join(): [1,2, 1]
async function in a function | Object.keys(arguments).join(): [0,1, 1]
async function in a function | (() => arguments.length)(): [2, 1]
async function in a function | (() => (arguments[0] = 9, a))(): [9, 9]
async function in a function | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async function in a function | eval('arguments.length'): [2, 1]
async function in a function | (arguments = 4, arguments): [4, 1]
async function in a function | var arguments = 4; arguments: [4, 1]
async function in a function | arguments === arguments: [true, 1]
async method, after an await | typeof arguments: [object, 1]
async method, after an await | arguments.length: [2, 1]
async method, after an await | arguments[0]: [1, 1]
async method, after an await | arguments[1]: [2, 1]
async method, after an await | (arguments[0] = 9, a): [9, 9]
async method, after an await | (a = 9, arguments[0]): [9, 9]
async method, after an await | (arguments[5] = 9, arguments.length): [2, 1]
async method, after an await | (arguments.length = 0, arguments.length): [0, 1]
async method, after an await | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async method, after an await | typeof arguments.callee: [function, 1]
async method, after an await | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async method, after an await | [...arguments].join(): [1,2, 1]
async method, after an await | Object.keys(arguments).join(): [0,1, 1]
async method, after an await | (() => arguments.length)(): [2, 1]
async method, after an await | (() => (arguments[0] = 9, a))(): [9, 9]
async method, after an await | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async method, after an await | eval('arguments.length'): [2, 1]
async method, after an await | (arguments = 4, arguments): [4, 1]
async method, after an await | var arguments = 4; arguments: [4, 1]
async method, after an await | arguments === arguments: [true, 1]
async method of a class, after an await | typeof arguments: [object, 1]
async method of a class, after an await | arguments.length: [2, 1]
async method of a class, after an await | arguments[0]: [1, 1]
async method of a class, after an await | arguments[1]: [2, 1]
async method of a class, after an await | (arguments[0] = 9, a): [1, 1]
async method of a class, after an await | (a = 9, arguments[0]): [1, 9]
async method of a class, after an await | (arguments[5] = 9, arguments.length): [2, 1]
async method of a class, after an await | (arguments.length = 0, arguments.length): [0, 1]
async method of a class, after an await | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async method of a class, after an await | typeof arguments.callee: TypeError
async method of a class, after an await | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async method of a class, after an await | [...arguments].join(): [1,2, 1]
async method of a class, after an await | Object.keys(arguments).join(): [0,1, 1]
async method of a class, after an await | (() => arguments.length)(): [2, 1]
async method of a class, after an await | (() => (arguments[0] = 9, a))(): [1, 1]
async method of a class, after an await | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async method of a class, after an await | eval('arguments.length'): [2, 1]
async method of a class, after an await | (arguments = 4, arguments): SyntaxError
async method of a class, after an await | var arguments = 4; arguments: SyntaxError
async method of a class, after an await | arguments === arguments: [true, 1]
arrow in an async function, after an await | typeof arguments: [object, 1]
arrow in an async function, after an await | arguments.length: [2, 1]
arrow in an async function, after an await | arguments[0]: [1, 1]
arrow in an async function, after an await | arguments[1]: [2, 1]
arrow in an async function, after an await | (arguments[0] = 9, a): [9, 9]
arrow in an async function, after an await | (a = 9, arguments[0]): [9, 9]
arrow in an async function, after an await | (arguments[5] = 9, arguments.length): [2, 1]
arrow in an async function, after an await | (arguments.length = 0, arguments.length): [0, 1]
arrow in an async function, after an await | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
arrow in an async function, after an await | typeof arguments.callee: [function, 1]
arrow in an async function, after an await | Object.prototype.toString.call(arguments): [[object Arguments], 1]
arrow in an async function, after an await | [...arguments].join(): [1,2, 1]
arrow in an async function, after an await | Object.keys(arguments).join(): [0,1, 1]
arrow in an async function, after an await | (() => arguments.length)(): [2, 1]
arrow in an async function, after an await | (() => (arguments[0] = 9, a))(): [9, 9]
arrow in an async function, after an await | (function () { return arguments.length; })(1, 2, 3): [3, 1]
arrow in an async function, after an await | eval('arguments.length'): [2, 1]
arrow in an async function, after an await | (arguments = 4, arguments): [4, 1]
arrow in an async function, after an await | var arguments = 4; arguments: [4, 1]
arrow in an async function, after an await | arguments === arguments: [true, 1]
async arrow in an async function, after awaits | typeof arguments: [object, 1]
async arrow in an async function, after awaits | arguments.length: [2, 1]
async arrow in an async function, after awaits | arguments[0]: [1, 1]
async arrow in an async function, after awaits | arguments[1]: [2, 1]
async arrow in an async function, after awaits | (arguments[0] = 9, a): [9, 9]
async arrow in an async function, after awaits | (a = 9, arguments[0]): [9, 9]
async arrow in an async function, after awaits | (arguments[5] = 9, arguments.length): [2, 1]
async arrow in an async function, after awaits | (arguments.length = 0, arguments.length): [0, 1]
async arrow in an async function, after awaits | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async arrow in an async function, after awaits | typeof arguments.callee: [function, 1]
async arrow in an async function, after awaits | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async arrow in an async function, after awaits | [...arguments].join(): [1,2, 1]
async arrow in an async function, after awaits | Object.keys(arguments).join(): [0,1, 1]
async arrow in an async function, after awaits | (() => arguments.length)(): [2, 1]
async arrow in an async function, after awaits | (() => (arguments[0] = 9, a))(): [9, 9]
async arrow in an async function, after awaits | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async arrow in an async function, after awaits | eval('arguments.length'): [2, 1]
async arrow in an async function, after awaits | (arguments = 4, arguments): [4, 1]
async arrow in an async function, after awaits | var arguments = 4; arguments: [4, 1]
async arrow in an async function, after awaits | arguments === arguments: [true, 1]
async generator function | typeof arguments: [object, 1]
async generator function | arguments.length: [2, 1]
async generator function | arguments[0]: [1, 1]
async generator function | arguments[1]: [2, 1]
async generator function | (arguments[0] = 9, a): [9, 9]
async generator function | (a = 9, arguments[0]): [9, 9]
async generator function | (arguments[5] = 9, arguments.length): [2, 1]
async generator function | (arguments.length = 0, arguments.length): [0, 1]
async generator function | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async generator function | typeof arguments.callee: [function, 1]
async generator function | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async generator function | [...arguments].join(): [1,2, 1]
async generator function | Object.keys(arguments).join(): [0,1, 1]
async generator function | (() => arguments.length)(): [2, 1]
async generator function | (() => (arguments[0] = 9, a))(): [9, 9]
async generator function | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async generator function | eval('arguments.length'): [2, 1]
async generator function | (arguments = 4, arguments): [4, 1]
async generator function | var arguments = 4; arguments: [4, 1]
async generator function | arguments === arguments: [true, 1]
async generator function, after an await | typeof arguments: [object, 1]
async generator function, after an await | arguments.length: [2, 1]
async generator function, after an await | arguments[0]: [1, 1]
async generator function, after an await | arguments[1]: [2, 1]
async generator function, after an await | (arguments[0] = 9, a): [9, 9]
async generator function, after an await | (a = 9, arguments[0]): [9, 9]
async generator function, after an await | (arguments[5] = 9, arguments.length): [2, 1]
async generator function, after an await | (arguments.length = 0, arguments.length): [0, 1]
async generator function, after an await | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async generator function, after an await | typeof arguments.callee: [function, 1]
async generator function, after an await | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async generator function, after an await | [...arguments].join(): [1,2, 1]
async generator function, after an await | Object.keys(arguments).join(): [0,1, 1]
async generator function, after an await | (() => arguments.length)(): [2, 1]
async generator function, after an await | (() => (arguments[0] = 9, a))(): [9, 9]
async generator function, after an await | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async generator function, after an await | eval('arguments.length'): [2, 1]
async generator function, after an await | (arguments = 4, arguments): [4, 1]
async generator function, after an await | var arguments = 4; arguments: [4, 1]
async generator function, after an await | arguments === arguments: [true, 1]
async generator method | typeof arguments: [object, 1]
async generator method | arguments.length: [2, 1]
async generator method | arguments[0]: [1, 1]
async generator method | arguments[1]: [2, 1]
async generator method | (arguments[0] = 9, a): [9, 9]
async generator method | (a = 9, arguments[0]): [9, 9]
async generator method | (arguments[5] = 9, arguments.length): [2, 1]
async generator method | (arguments.length = 0, arguments.length): [0, 1]
async generator method | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async generator method | typeof arguments.callee: [function, 1]
async generator method | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async generator method | [...arguments].join(): [1,2, 1]
async generator method | Object.keys(arguments).join(): [0,1, 1]
async generator method | (() => arguments.length)(): [2, 1]
async generator method | (() => (arguments[0] = 9, a))(): [9, 9]
async generator method | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async generator method | eval('arguments.length'): [2, 1]
async generator method | (arguments = 4, arguments): [4, 1]
async generator method | var arguments = 4; arguments: [4, 1]
async generator method | arguments === arguments: [true, 1]
async generator method of a class | typeof arguments: [object, 1]
async generator method of a class | arguments.length: [2, 1]
async generator method of a class | arguments[0]: [1, 1]
async generator method of a class | arguments[1]: [2, 1]
async generator method of a class | (arguments[0] = 9, a): [1, 1]
async generator method of a class | (a = 9, arguments[0]): [1, 9]
async generator method of a class | (arguments[5] = 9, arguments.length): [2, 1]
async generator method of a class | (arguments.length = 0, arguments.length): [0, 1]
async generator method of a class | (delete arguments[0], a = 5, arguments[0]): [undefined, 5]
async generator method of a class | typeof arguments.callee: TypeError
async generator method of a class | Object.prototype.toString.call(arguments): [[object Arguments], 1]
async generator method of a class | [...arguments].join(): [1,2, 1]
async generator method of a class | Object.keys(arguments).join(): [0,1, 1]
async generator method of a class | (() => arguments.length)(): [2, 1]
async generator method of a class | (() => (arguments[0] = 9, a))(): [1, 1]
async generator method of a class | (function () { return arguments.length; })(1, 2, 3): [3, 1]
async generator method of a class | eval('arguments.length'): [2, 1]
async generator method of a class | (arguments = 4, arguments): SyntaxError
async generator method of a class | var arguments = 4; arguments: SyntaxError
async generator method of a class | arguments === arguments: [true, 1]
generator function | constant texts: [2, 9, 9]
generator method of a class | constant texts: [2, 1, 1]
async function, after an await | constant texts: [2, 9, 9]
async generator function | constant texts: [2, 9, 9]
*/
