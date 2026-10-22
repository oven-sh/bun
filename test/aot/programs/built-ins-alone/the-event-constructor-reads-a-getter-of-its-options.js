const options = {
  count: 0,
  get cancelable() {
    this.count++;
    console.log("cancelable", this === options);
    return true;
  },
};
console.log(new Event("ready", options).cancelable);
console.log(options.count);
