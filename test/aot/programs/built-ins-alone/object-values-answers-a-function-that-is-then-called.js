const table = {
  work(value) {
    return value + 1;
  },
};
console.log(Object.values(table)[0](1.5));
