const options = {
  count: 0,
  get type() {
    this.count++;
    console.log("type", this === options);
    return "text/plain";
  },
};
console.log(new Blob(["a"], options).type);
console.log(options.count);
