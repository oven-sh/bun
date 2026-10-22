const matcher = {
  [Symbol.match](text) {
    console.log("match", typeof text, text.length, this === matcher);
    return 1.5;
  },
};
console.log("banana".match(matcher) + 1);
