const matcher = {
  [Symbol.replace](text, replacement) {
    console.log("replace", typeof text, text.length, typeof replacement, this === matcher);
    return 1.5;
  },
};
console.log("banana".replace(matcher, "-") + 1);
