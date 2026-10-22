let calls = 0;
console.log({
  get size() {
    calls++;
    return 1.5;
  },
  toJSON() {
    calls++;
  },
});
console.log(calls);
