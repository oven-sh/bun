const options = {
  count: 0,
  get highWaterMark() {
    this.count++;
    console.log("highWaterMark", this === options);
    return 2;
  },
};
console.log(typeof new ReadableStream({}, options));
console.log(options.count);
