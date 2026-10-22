const options = {
  count: 0,
  get cause() {
    this.count++;
    console.log("cause", this === options);
    return 1.5;
  },
};
console.log(new Error("failed", options).cause + 1);
console.log(options.count);
