// The `next` and `return` of an iterator call a function that reads the bindings of the array pattern being bound: a closure that exists before the declaration ends sees each binding from its own step on.
const attempt = (read) => {
  try {
    return String(read());
  } catch (error) {
    return error.name;
  }
};
const both = (first, second) => attempt(first) + " " + attempt(second);

function steps(label, values, read, throwAt = -1) {
  let index = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      console.log(label, "next", index, "sees", read());
      if (index === throwAt) throw new RangeError("step " + index);
      return index < values.length ? { value: values[index++], done: false } : { value: undefined, done: true };
    },
    return() {
      console.log(label, "return sees", read());
      return {};
    },
  };
}

function earlierArrow() {
  const read = () => both(() => a, () => b);
  const [a, b] = steps("earlier arrow", ["A", "B"], read);
  return read();
}

function earlierArrowAndLet() {
  const read = () => both(() => a, () => b);
  let [a, b = "default"] = steps("earlier arrow and let", ["A"], read);
  a += "!";
  return read();
}

function hoistedFunction() {
  const [a, b] = steps("hoisted function", ["A", "B"], read);
  return read();
  function read() {
    return both(() => a, () => b);
  }
}

function ownInitializer() {
  const [a, b] = steps("own initializer", ["A", "B"], () => both(() => a, () => b));
  return a + b;
}

function ownDefault() {
  const readers = [];
  const read = () => readers.map((reader) => attempt(reader)).join(" ") || "no reader";
  const [a, keep = readers.push(() => a), b] = steps("own default", ["A", undefined, "B"], read);
  return a + keep + b;
}

function earlierClass() {
  class Reader {
    static read() {
      return both(() => a, () => b);
    }
  }
  const [a, b] = steps("earlier class", ["A", "B"], Reader.read);
  return Reader.read();
}

function earlierEval() {
  const read = () => both(() => eval("a"), () => eval("b"));
  const [a, b] = steps("earlier eval", ["A", "B"], read);
  return read();
}

function closureFromEval() {
  const read = eval("() => both(() => a, () => b)");
  const [a, b] = steps("closure from eval", ["A", "B"], read);
  return read();
}

function laterEval() {
  const [a, b] = steps("later eval", ["A", "B"], () => "nothing");
  return eval("a + b");
}

function laterArrow() {
  const [a, b] = steps("later arrow", ["A", "B"], () => "nothing");
  return () => a + b;
}

function laterArrowWithDefaults() {
  const [a = "default a", b = () => "default b", c = []] = steps("later arrow with defaults", [], () => "nothing");
  return () => a + b() + c.length;
}

function variables() {
  const read = () => both(() => a, () => b);
  var [a, b] = steps("var", ["A", "B"], read);
  return read();
}

function assignment() {
  let a = "old a";
  let b = "old b";
  const read = () => a + " " + b;
  [a, b] = steps("assignment", ["A", "B"], read);
  return read();
}

function handler() {
  let a = "old a";
  let b = "old b";
  try {
    [a, b] = steps("handler", ["A", "B"], () => "nothing", 1);
  } catch (error) {
    return a + " " + b + " " + error.message;
  }
  return "no error";
}

function parameters(read = () => both(() => a, () => b), [a, b] = steps("parameters", ["A", "B"], read)) {
  return read();
}

function parameterPattern([a, b]) {
  return () => a + b;
}

function parameterAndHoistedFunction([a, b]) {
  return read;
  function read() {
    return a + b;
  }
}

function catchParameter() {
  try {
    throw steps("catch parameter", ["A", "B"], () => "nothing");
  } catch ([a, b]) {
    return () => a + b;
  }
}

function loopHead() {
  const readers = [];
  const last = () => (readers.length ? readers[readers.length - 1]() : "no reader");
  for (const [a, b] of [steps("loop head 1", ["A", "B"], last), steps("loop head 2", ["C", "D"], last)]) readers.push(() => a + b);
  return readers.map((reader) => reader()).join(" ");
}

function nestedLoopHead() {
  const readers = [];
  const last = () => (readers.length ? readers[readers.length - 1]() : "no reader");
  for (const { pair: [a, b] } of [{ pair: steps("nested loop head 1", ["A", "B"], last) }, { pair: steps("nested loop head 2", ["C", "D"], last) }]) readers.push(() => a + b);
  return readers.map((reader) => reader()).join(" ");
}

function loopBody() {
  const readers = [];
  const last = () => (readers.length ? readers[readers.length - 1]() : "no reader");
  for (const values of [["A", "B"], ["C", "D"]]) {
    const [a, b] = steps("loop body", values, last);
    readers.push(() => a + b);
  }
  return readers.map((reader) => reader()).join(" ");
}

function loopInitializer() {
  const readers = [];
  for (let [a, b] = steps("loop initializer", [0, 3], () => readers.length); a < b; a++) readers.push(() => a);
  return readers.map((reader) => reader()).join(" ");
}

function* generator() {
  const [a, b] = steps("generator", ["A", "B"], () => "nothing");
  yield () => a;
  yield () => b;
}

console.log(earlierArrow());
console.log(earlierArrowAndLet());
console.log(hoistedFunction());
console.log(ownInitializer());
console.log(ownDefault());
console.log(earlierClass());
console.log(earlierEval());
console.log(closureFromEval());
console.log(laterEval());
console.log(laterArrow()());
console.log(laterArrowWithDefaults()());
console.log(variables());
console.log(assignment());
console.log(handler());
console.log(parameters());
console.log(parameterPattern(steps("parameter pattern", ["A", "B"], () => "nothing"))());
console.log(parameterAndHoistedFunction(steps("parameter and hoisted function", ["A", "B"], () => "nothing"))());
console.log(catchParameter()());
console.log(loopHead());
console.log(nestedLoopHead());
console.log(loopBody());
console.log(loopInitializer());
console.log([...generator()].map((reader) => reader()).join(" "));

const readModule = () => both(() => first, () => second);
const [first, second] = steps("module", ["A", "B"], readModule);
console.log(readModule());

const [third, fourth] = steps("module and later arrow", ["C", "D"], () => "nothing");
const readLater = () => third + fourth;
console.log(readLater());

try {
  throw steps("module catch parameter", ["A", "B"], () => "nothing");
} catch ([a, b]) {
  globalThis.readCaught = () => a + b;
}
console.log(globalThis.readCaught());
