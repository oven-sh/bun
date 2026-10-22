const options = {
  count: 0,
  get type() {
    this.count++;
    console.log("type", this === options);
    return "ordinal";
  },
};
console.log(new Intl.PluralRules("en-US", options).select(2));
console.log(options.count);
