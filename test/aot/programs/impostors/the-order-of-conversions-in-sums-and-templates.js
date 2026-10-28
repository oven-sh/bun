function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const log = [];

function noisy(name, result) {
  return {
    [Symbol.toPrimitive](hint) {
      log.push(name + ":" + hint);
      return result;
    },
  };
}

function evaluated(name, value) {
  log.push("evaluate " + name);
  return value;
}

function sumOfThree(a, b, c) {
  return a + b + c;
}

function sumWithLiterals(a, b) {
  return "[" + a + "|" + b + "]";
}

function sumGroupedRight(a, b, c) {
  return a + (b + c);
}

function template(a, b, c) {
  return `${a}-${b}-${c}`;
}

function templateOfCalls() {
  return `${evaluated("a", noisy("a", 1))}-${evaluated("b", noisy("b", 2))}-${evaluated("c", noisy("c", 3))}`;
}

function sumOfCalls() {
  return evaluated("a", noisy("a", 1)) + "-" + evaluated("b", noisy("b", 2)) + "-" + evaluated("c", noisy("c", 3));
}

function report(label, run) {
  attempt(label, run);
  console.log("  order:", log.splice(0).join(" "));
}

for (let i = 0; i < 2000; i++) {
  sumOfThree("a", "b", "c");
  sumWithLiterals("a", "b");
  sumGroupedRight("a", "b", "c");
  template("a", "b", "c");
}

report("numbers are added before the text", () => sumOfThree(1, 2, "3"));
report("the text comes first", () => sumOfThree("1", 2, 3));
report("grouped to the right", () => sumGroupedRight(1, 2, "3"));
report("three objects that give numbers", () => sumOfThree(noisy("a", 1), noisy("b", 2), noisy("c", 3)));
report("three objects, the last gives a text", () => sumOfThree(noisy("a", 1), noisy("b", 2), noisy("c", "3")));
report("three objects grouped to the right", () => sumGroupedRight(noisy("a", 1), noisy("b", 2), noisy("c", "3")));
report("objects between literals", () => sumWithLiterals(noisy("a", 1), noisy("b", -0)));
report("a symbol second: the first is converted already", () => sumWithLiterals(noisy("a", 1), Symbol("s")));
report("a symbol first: the second is never converted", () => sumWithLiterals(Symbol("s"), noisy("b", 1)));
report("objects in a template", () => template(noisy("a", 1), noisy("b", null), noisy("c", undefined)));
report("a symbol in the middle of a template", () => template(noisy("a", 1), Symbol("s"), noisy("c", 3)));
report("an object that gives a symbol in a template", () => template(noisy("a", 1), noisy("b", Symbol("s")), noisy("c", 3)));
report("a BigInt and a number", () => sumOfThree(1n, 2, "3"));
report("a BigInt and a text", () => sumOfThree(1n, "2", 3));
report("a BigInt from an object and a number from another", () => sumOfThree(noisy("a", 1n), noisy("b", 2), noisy("c", "3")));
report("a template evaluates and converts each in turn", templateOfCalls);
report("a sum evaluates and converts in pairs", sumOfCalls);
report("null and undefined", () => [sumOfThree(null, undefined, ""), sumOfThree(null, 1, ""), sumOfThree(undefined, 1, ""), sumOfThree("", null, undefined), template(null, undefined, "")]);
report("true and false", () => [sumOfThree(true, true, ""), sumOfThree("", true, true), sumOfThree(true, null, "x")]);
report("lists", () => [sumOfThree([], [], ""), sumOfThree([1], [2], 3), sumOfThree([], {}, ""), sumOfThree(1, [], 2), sumOfThree(1, [2], 3)]);
report("minus zero", () => [sumOfThree(-0, "", ""), sumOfThree(-0, -0, ""), sumOfThree(-0, 0, ""), template(-0, 0, -0)]);
report("honest again", () => [sumOfThree("a", "b", "c"), sumWithLiterals("a", "b"), sumGroupedRight("a", "b", "c"), template("a", "b", "c")]);
