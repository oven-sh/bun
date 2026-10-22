const like = {
  size: 5,
  has(value) {
    console.log("has", value);
    return true;
  },
  keys() {
    return [].values();
  },
};
console.log(new Set([1.5]).isSubsetOf(like));
