const options = {
  count: 0,
  get then() {
    this.count++;
    console.log("then", this === options);
    return undefined;
  },
};
console.log((await Array.fromAsync([options]))[0] === options);
console.log(options.count);
