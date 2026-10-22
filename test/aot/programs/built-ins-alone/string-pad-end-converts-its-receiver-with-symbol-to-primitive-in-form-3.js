let calls = 0;
const probe = {
  work: String.prototype.padEnd,
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return "banana";
  },
};
const result = probe.work(8, "-");
console.log(typeof result, result.length, result);
console.log(calls);
