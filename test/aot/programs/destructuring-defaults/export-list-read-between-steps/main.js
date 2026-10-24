// The names of a `const` array pattern are exported by a list after the declaration. The iterator's `next` and `return` call a function of another module, which imports them in a cycle and sees each one from its own step on.
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

const [first, second] = steps(["A", "B", "unread"]);
export { first, second as renamed };
console.log(first, second, read());
