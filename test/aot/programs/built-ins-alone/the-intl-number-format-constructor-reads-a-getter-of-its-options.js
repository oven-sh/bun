const options = {
  count: 0,
  get style() {
    this.count++;
    console.log("style", this === options);
    return "percent";
  },
};
console.log(new Intl.NumberFormat("en-US", options).format(0.5));
console.log(options.count);
