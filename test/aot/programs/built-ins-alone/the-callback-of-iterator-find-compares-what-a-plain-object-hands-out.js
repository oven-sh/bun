const counter = {
  i: 1,
  next() {
    if (this.i > 5) return { value: this.i, done: true };
    return { value: this.i++, done: false };
  },
};
const seen = [];
Iterator.prototype.find.call(counter, value => {
  seen.push(value, value > 4, typeof value);
  return false;
});
console.log(seen.join());
