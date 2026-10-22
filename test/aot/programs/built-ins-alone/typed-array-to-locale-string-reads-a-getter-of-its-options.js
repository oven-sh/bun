const options = {
  count: 0,
  get minimumFractionDigits() {
    this.count++;
    console.log("minimumFractionDigits", this === options);
    return 1;
  },
};
console.log(new Uint8Array([5]).toLocaleString("en-US", options));
console.log(options.count);
