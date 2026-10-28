const values = [1, 2, 3, 4, 5];
const counter = {
  next() {
    if (values.length === 0) return { value: undefined, done: true };
    return { value: values.shift(), done: false };
  },
};
console.log(Iterator.prototype.find.call(counter, value => value > 4));
