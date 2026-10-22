const options = {
  count: 0,
  get stream() {
    this.count++;
    console.log("stream", this === options);
    return true;
  },
};
console.log(new TextDecoder().decode(new Uint8Array([104]), options));
console.log(options.count);
