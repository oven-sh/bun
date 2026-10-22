let calls = 0;
const probe = {
  valueOf() {
    calls++;
    return 1;
  },
  toString() {
    calls++;
    return "text";
  },
};
console.log("%s %d", "a", 1.5, typeof probe);
console.log(calls);
