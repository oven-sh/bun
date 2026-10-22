const like = {
  get size() {
    console.log("size");
    return 1;
  },
  has(value) {
    console.log("has", value);
    return value === 2.5;
  },
  keys() {
    console.log("keys");
    return [2.5].values();
  },
};
console.log([...new Set([1.5]).union(like)].join());
