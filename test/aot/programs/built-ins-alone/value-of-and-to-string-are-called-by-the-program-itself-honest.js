const probe = {
  count: 0,
  valueOf() {
    this.count++;
    return 1.5;
  },
  toString() {
    this.count++;
    return "text";
  },
};
console.log(probe.valueOf() + 1, probe.toString().length, probe.count);
