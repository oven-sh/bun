// Text that is evaluated in a method reads an `accessor` field, stores to it and asks for its name, once the object is made. Some of the text is put together at run time. The same for a `static accessor` field, which a subclass does not have.
const lines = [];
function attempt(label, run) {
  try {
    lines.push(label + ": " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.name + ": " + error.message);
  }
}
class Counter {
  accessor #count = 1;
  #step = 2;
  ask(text) {
    return eval(text);
  }
  read() {
    return this.#count;
  }
}
const counter = new Counter();
lines.push("read: " + counter.ask("this.#count"));
lines.push("store: " + counter.ask("this.#count = this.#count + this.#step"));
lines.push("read by compiled code: " + counter.read());
lines.push("has: " + counter.ask("#count in this") + " " + counter.ask("#count in {}"));
const text = ["th", "is.#co", "unt += 10"].join("");
lines.push("text put together at run time: " + counter.ask(text) + " " + counter.read());
class Registry {
  static accessor #total = 7;
  static ask(text) {
    return eval(text);
  }
  static read() {
    return this.#total;
  }
}
class Below extends Registry {}
lines.push("static, read: " + Registry.ask("this.#total"));
lines.push("static, store: " + Registry.ask("this.#total = this.#total + 1"));
lines.push("static, read by compiled code: " + Registry.read());
lines.push("static, has: " + Registry.ask("#total in this") + " " + Registry.ask("#total in Below"));
const staticText = ["th", "is.#to", "tal += 10"].join("");
lines.push("static, text put together at run time: " + Registry.ask(staticText) + " " + Registry.read());
attempt("static, read on a subclass", () => Registry.ask.call(Below, "this.#total"));
attempt("static, store on a subclass", () => Registry.ask.call(Below, "this.#total = 1"));
attempt("static, has of a number", () => Registry.ask("#total in 5"));
console.log(lines.join("\n"));
