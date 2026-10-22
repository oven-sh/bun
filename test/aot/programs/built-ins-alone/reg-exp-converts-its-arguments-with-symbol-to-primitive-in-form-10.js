let calls = 0;
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = new RegExp(probe);
console.log(result instanceof RegExp, result.source, result.flags, result.lastIndex, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
