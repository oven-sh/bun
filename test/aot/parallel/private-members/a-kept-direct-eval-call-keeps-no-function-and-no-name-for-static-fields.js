// What a direct eval call keeps alive while the function that its text made is kept. In a class with static private fields the call keeps one function, the one that the text made: no function for a field, and no name of its own, whether the text reads the fields or not. Each count is the average over 300 kept calls after a full collection, held to a bound that `bun <file>` meets too.
// Todo: "missed" | "met": a wrong answer today: under `bun build --compile --aot` it prints "missed", where `bun <file>` prints "met". The engine that Bun pins makes two functions and an object for each static private field at every direct eval call. oven-sh/WebKit#1020 makes one name for a field of a class object, when a text first asks: the line goes out with the pin that has it
const { heapStats } = require("bun:jsc");
const lines = [];
function counts() {
  Bun.gc(true);
  const all = heapStats().objectTypeCounts;
  return { functions: all.Function ?? 0, names: all.symbol ?? 0 };
}
function measure(label, ask, text) {
  const calls = 300;
  const kept = [];
  kept.push(ask(text));
  const before = counts();
  for (let i = 0; i < calls; i++) kept.push(ask(text));
  const after = counts();
  const functions = (after.functions - before.functions) / calls;
  const names = (after.names - before.names) / calls;
  const isWithinBounds = functions < 1.5 && names < 0.5;
  lines.push(
    label +
      ": the bound is " +
      (isWithinBounds ? "met" : "missed") +
      ": one function a call and no name (" +
      kept.length +
      " functions are kept)",
  );
}
class OneField {
  static #first = 1;
  static ask(text) {
    return eval(text);
  }
}
class ThreeFields {
  static #first = 1;
  static #second = 2;
  static #third = 3;
  static ask(text) {
    return eval(text);
  }
}
class TenFields {
  static #a = 1;
  static #b = 2;
  static #c = 3;
  static #d = 4;
  static #e = 5;
  static #f = 6;
  static #g = 7;
  static #h = 8;
  static #i = 9;
  static #j = 10;
  static ask(text) {
    return eval(text);
  }
}
class FieldAndMethod {
  static #first = 1;
  static #helper() {
    return 2;
  }
  static ask(text) {
    return eval(text);
  }
}
measure("one static private field, a text that names none", text => OneField.ask(text), "() => 0");
measure("one static private field, a text that reads it", text => OneField.ask(text), "[this.#first, () => 0][1]");
measure("three static private fields, a text that names none", text => ThreeFields.ask(text), "() => 0");
measure(
  "three static private fields, a text that reads one",
  text => ThreeFields.ask(text),
  "[this.#second, () => 0][1]",
);
measure(
  "three static private fields, a text that reads all",
  text => ThreeFields.ask(text),
  "[this.#first + this.#second + this.#third, () => 0][1]",
);
measure("ten static private fields, a text that names none", text => TenFields.ask(text), "() => 0");
measure(
  "a static private field beside a static private method, a text that names none",
  text => FieldAndMethod.ask(text),
  "() => 0",
);
console.log(lines.join("\n"));
