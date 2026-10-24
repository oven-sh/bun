// The tests of the `case` clauses run before the statements of any clause, and a function declared in one clause exists in all of them: a closure from either sees each binding of an array pattern in another clause from its own step on.
const attempt = (read) => {
  try {
    return String(read());
  } catch (error) {
    return error.name;
  }
};
const both = (first, second) => attempt(first) + " " + attempt(second);

function steps(label, values, read) {
  let index = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      console.log(label, "next", index, "sees", read());
      return index < values.length ? { value: values[index++], done: false } : { value: undefined, done: true };
    },
    return() {
      console.log(label, "return sees", read());
      return {};
    },
  };
}

function testAfterDefault(selector) {
  let read = () => "no reader";
  switch (selector) {
    default:
      const [a, b] = steps("test after default", ["A", "B"], () => read());
      return read();
    case (read = () => both(() => a, () => b), "never"):
      return "matched";
  }
}

function functionInLaterClause(selector) {
  switch (selector) {
    case 0:
      const [a, b] = steps("function in later clause", ["A", "B"], read);
      return read();
    case 1:
      function read() {
        return both(() => a, () => b);
      }
  }
}

function arrowInLaterClause(selector) {
  switch (selector) {
    case 0:
      const [a, b] = steps("arrow in later clause", ["A", "B"], () => "nothing");
    case 1:
      return () => both(() => a, () => b);
  }
}

function closureOfHoistedFunction() {
  const [a, b] = steps("closure of hoisted function", ["A", "B"], () => makeReader()());
  return makeReader()();
  function makeReader() {
    return () => both(() => a, () => b);
  }
}

function functionInLaterBlock() {
  const [a, b] = steps("function in later block", ["A", "B"], () => "nothing");
  {
    function read() {
      return both(() => a, () => b);
    }
    return read();
  }
}

console.log(testAfterDefault("other"));
console.log(functionInLaterClause(0));
console.log(arrowInLaterClause(0)());
console.log(arrowInLaterClause(1)());
console.log(closureOfHoistedFunction());
console.log(functionInLaterBlock());
