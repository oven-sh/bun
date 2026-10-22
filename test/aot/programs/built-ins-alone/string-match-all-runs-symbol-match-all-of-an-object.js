const matcher = {
  [Symbol.matchAll](text) {
    console.log("matchAll", typeof text, text.length);
    return 1.5;
  },
};
console.log("banana".matchAll(matcher) + 1);
