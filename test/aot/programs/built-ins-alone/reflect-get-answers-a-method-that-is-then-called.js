const table = {
  work(value) {
    return value + 1;
  },
};
console.log(Reflect.get(table, "work")(1.5));
