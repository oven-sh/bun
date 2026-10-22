const options = {
  count: 0,
  get numeric() {
    this.count++;
    console.log("numeric", this === options);
    return "auto";
  },
};
console.log(new Intl.RelativeTimeFormat("en-US", options).format(-1, "day"));
console.log(options.count);
