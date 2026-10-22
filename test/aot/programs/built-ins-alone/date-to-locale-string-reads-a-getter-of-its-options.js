const options = {
  count: 0,
  get timeZone() {
    this.count++;
    console.log("timeZone", this === options);
    return "UTC";
  },
};
console.log(new Date(0).toLocaleString("en-US", options));
console.log(options.count);
