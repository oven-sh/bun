const options = {
  count: 0,
  get once() {
    this.count++;
    console.log("once", this === options);
    return true;
  },
};
console.log(new EventTarget().addEventListener("ready", () => {}, options));
console.log(options.count);
