let calls = 0;
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
const result = Bun.JSONL.parse(probe);
console.log(Array.isArray(result), result.length);
console.log(calls);
