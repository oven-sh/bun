let calls = 0;
const probe = {
  work: String.prototype.split,
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
const result = probe.work("n", 2);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(calls);
