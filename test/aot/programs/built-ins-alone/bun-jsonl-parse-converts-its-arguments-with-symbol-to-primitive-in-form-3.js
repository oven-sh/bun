let calls = 0;
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = Bun.JSONL.parse(probe);
console.log(Array.isArray(result), result.length);
console.log(calls);
