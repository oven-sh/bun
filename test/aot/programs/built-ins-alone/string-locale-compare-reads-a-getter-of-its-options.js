const options = {
  count: 0,
  get sensitivity() {
    this.count++;
    console.log("sensitivity", this === options);
    return "base";
  },
};
console.log("a".localeCompare("A", "en-US", options));
console.log(options.count);
