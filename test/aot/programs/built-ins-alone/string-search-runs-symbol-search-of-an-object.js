const matcher = {
  [Symbol.search](text) {
    console.log("search", typeof text, text.length);
    return "found";
  },
};
console.log("banana".search(matcher).length);
