const list = [2, 1];
list.sort((left, right) => ({
  valueOf() {
    return left - right;
  },
}));
console.log(list.join());
