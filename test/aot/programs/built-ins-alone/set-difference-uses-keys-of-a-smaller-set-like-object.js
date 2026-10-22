const like = {
  size: 1,
  has(value) {
    console.log("has", value);
    return false;
  },
  keys() {
    console.log("keys");
    let done = false;
    return {
      next() {
        console.log("next");
        const step = { done, value: 1.5 };
        done = true;
        return step;
      },
    };
  },
};
console.log([...new Set([1.5, "two"]).difference(like)].join());
