const like = {
  size: 5,
  has(value) {
    console.log("has", typeof value, value);
    return value === 1.5;
  },
  keys() {
    console.log("keys");
    return [1.5].values();
  },
};
console.log([...new Set([1.5, "two"]).intersection(like)].join());
