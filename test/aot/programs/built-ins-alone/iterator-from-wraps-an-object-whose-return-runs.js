let count = 0;
const source = {
  next() {
    count++;
    console.log("next", count);
    return count > 2 ? { done: true, value: undefined } : { done: false, value: count + 0.5 };
  },
  return() {
    console.log("return");
    return {};
  },
};
const wrapped = Iterator.from(source);
console.log(wrapped.return().done);
