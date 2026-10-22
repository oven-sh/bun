const options = {
  count: 0,
  get depth() {
    this.count++;
    console.log("depth", this === options);
    return 0;
  },
};
console.log(Bun.inspect({ a: { b: 1 } }, options));
console.log(options.count);
