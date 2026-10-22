const options = {
  count: 0,
  get maxByteLength() {
    this.count++;
    console.log("maxByteLength", this === options);
    return 16;
  },
};
console.log(new ArrayBuffer(8, options).maxByteLength + 1);
console.log(options.count);
