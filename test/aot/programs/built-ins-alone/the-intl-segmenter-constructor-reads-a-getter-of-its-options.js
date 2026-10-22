const options = {
  count: 0,
  get granularity() {
    this.count++;
    console.log("granularity", this === options);
    return "word";
  },
};
console.log([...new Intl.Segmenter("en-US", options).segment("a b")].length);
console.log(options.count);
