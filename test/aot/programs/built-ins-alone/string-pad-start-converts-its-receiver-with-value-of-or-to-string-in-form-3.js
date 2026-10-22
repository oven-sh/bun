let calls = 0;
const probe = {
  work: String.prototype.padStart,
  valueOf() {
    calls++;
    console.log("probe valueOf", this === probe);
    return "banana";
  },
  toString() {
    calls++;
    console.log("probe toString", this === probe);
    return "banana";
  },
};
const result = probe.work(8, "-");
console.log(typeof result, result.length, result);
console.log(calls);
