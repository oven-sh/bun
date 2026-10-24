// Array.from alone in a program: whatever it calls on its operand is in the executable: the iterators of a set, a map, a string, a typed array and a generator, an iterator of the program with `return`, and the length and the elements of an array-like object.
console.log(Array.from(new Set([1, 2])).join());
console.log(Array.from(new Map([[1, 2]]).keys()).join(), Array.from(new Map([[1, 2]])).join("|"));
console.log(Array.from("a\u{1F600}b").length);
console.log(Array.from(new Uint8Array([7, 8])).join());
console.log(Array.from({ length: 2, 0: "x", 1: "y" }).join());
console.log(Array.from((function* () { yield 1; yield 2; })()).join());
const closing = {
  [Symbol.iterator]() {
    return {
      next: () => ({ done: false, value: 1 }),
      return() {
        console.log("closed");
        return {};
      },
    };
  },
};
try {
  Array.from(closing, () => {
    throw new Error("stop");
  });
} catch (error) {
  console.log(error.message);
}
