let calls = 0;
const probe = {
  valueOf() {
    calls++;
    console.log("probe valueOf", this === probe);
    return 16;
  },
  toString() {
    calls++;
    console.log("probe toString", this === probe);
    return "16";
  },
};
const result = (1.5).toString(probe);
console.log(typeof result, result.length, result);
console.log(calls);
