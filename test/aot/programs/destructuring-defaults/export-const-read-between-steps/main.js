// An exported `const` array pattern reads an iterator whose `next` and `return` call a function of another module, which imports the bindings in a cycle and sees each one from its own step on.
import { read } from "./lib.js";

function steps(values) {
  let index = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      console.log("next", index, "sees", read());
      return index < values.length ? { value: values[index++], done: false } : { value: undefined, done: true };
    },
    return() {
      console.log("return sees", read());
      return {};
    },
  };
}

export const [first, second = "default"] = steps(["A", undefined, "unread"]);
console.log(first, second, read());
