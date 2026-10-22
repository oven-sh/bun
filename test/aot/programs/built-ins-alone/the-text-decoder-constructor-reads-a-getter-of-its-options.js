const options = {
  count: 0,
  get fatal() {
    this.count++;
    console.log("fatal", this === options);
    return true;
  },
};
console.log(new TextDecoder("utf-8", options).fatal);
console.log(options.count);
