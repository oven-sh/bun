// Object is its own iterator protocol: compiled answers as plain.
const it = {
  i: 0,
  next() {
    return { done: this.i >= 3, value: this.i++ };
  },
  [Symbol.iterator]() {
    return this;
  },
  return() {
    console.log("return called");
    return {};
  },
};
const [a, b] = it;
console.log(a, b, [...it].join(), it.i);
