const options = {
  count: 0,
  get type() {
    this.count++;
    console.log("type", this === options);
    return "disjunction";
  },
};
console.log(new Intl.ListFormat("en-US", options).format(["a", "b"]));
console.log(options.count);
