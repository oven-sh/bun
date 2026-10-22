const matcher = {
  [Symbol.split](text, limit) {
    console.log("split", typeof text, typeof limit, limit);
    return 1.5;
  },
};
console.log("banana".split(matcher, 3) + 1);
