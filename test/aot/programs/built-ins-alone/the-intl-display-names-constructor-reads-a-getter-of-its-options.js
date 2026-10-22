const options = {
  count: 0,
  get type() {
    this.count++;
    console.log("type", this === options);
    return "region";
  },
};
console.log(new Intl.DisplayNames("en-US", options).of("US"));
console.log(options.count);
