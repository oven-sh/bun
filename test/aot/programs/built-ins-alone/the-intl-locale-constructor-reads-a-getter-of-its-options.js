const options = {
  count: 0,
  get region() {
    this.count++;
    console.log("region", this === options);
    return "GB";
  },
};
console.log(new Intl.Locale("en", options).toString());
console.log(options.count);
