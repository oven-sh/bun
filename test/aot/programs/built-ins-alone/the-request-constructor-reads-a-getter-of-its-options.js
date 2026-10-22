const options = {
  count: 0,
  get method() {
    this.count++;
    console.log("method", this === options);
    return "POST";
  },
};
console.log(new Request("https://example.com/", options).method);
console.log(options.count);
