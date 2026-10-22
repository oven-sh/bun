let calls = 0;
const subject = new URLSearchParams("first=1&second=two&first=3");
const probe = {
  valueOf() {
    calls++;
    console.log("probe valueOf", this === probe);
    return "an";
  },
  toString() {
    calls++;
    console.log("probe toString", this === probe);
    return "an";
  },
};
const result = subject.getAll(probe);
console.log(Array.isArray(result), result.length);
console.log(calls);
