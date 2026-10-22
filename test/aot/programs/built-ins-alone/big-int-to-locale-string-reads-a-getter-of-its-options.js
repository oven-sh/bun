const options = {
  count: 0,
  get useGrouping() {
    this.count++;
    console.log("useGrouping", this === options);
    return false;
  },
};
console.log(12345n.toLocaleString("en-US", options));
console.log(options.count);
