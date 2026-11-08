// Text that is evaluated in a method reads an `accessor` field, stores to it and asks for its name, once the object is made. Some of the text is put together at run time
const lines = [];
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
console.log(lines.join("\n"));
