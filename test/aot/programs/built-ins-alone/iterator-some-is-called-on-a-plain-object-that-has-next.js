const counter = {
  i: 1,
  next() {
    if (this.i > 5) return { value: this.i, done: true };
    return { value: this.i++, done: false };
  },
};
console.log(Iterator.prototype.some.call(counter, value => value > 4));
