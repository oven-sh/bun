const options = {
  count: 0,
  get style() {
    this.count++;
    console.log("style", this === options);
    return "percent";
  },
};
console.log((0.5).toLocaleString("en-US", options));
console.log(options.count);
