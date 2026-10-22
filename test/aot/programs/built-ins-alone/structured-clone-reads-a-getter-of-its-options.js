const options = {
  count: 0,
  get transfer() {
    this.count++;
    console.log("transfer", this === options);
    return [];
  },
};
console.log(structuredClone(1.5, options) + 1);
console.log(options.count);
