const mixin = {
  work(value) {
    return value + 1;
  },
};
console.log(Object.assign({}, mixin).work(1.5));
