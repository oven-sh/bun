const options = {
  count: 0,
  get timeZone() {
    this.count++;
    console.log("timeZone", this === options);
    return "UTC";
  },
};
console.log(new Intl.DateTimeFormat("en-US", options).format(0));
console.log(options.count);
