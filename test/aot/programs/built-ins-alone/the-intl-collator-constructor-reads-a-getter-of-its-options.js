const options = {
  count: 0,
  get numeric() {
    this.count++;
    console.log("numeric", this === options);
    return true;
  },
};
console.log(new Intl.Collator("en-US", options).compare("2", "10"));
console.log(options.count);
