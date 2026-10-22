let calls = 0;
const probe = {
  count: 0,
  work: String.prototype.match,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "banana";
  },
};
const result = probe.work("an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result.index, result.index + 1, typeof result.input, result.input.length, result.input);
console.log(typeof result.groups, result.groups === undefined, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.work, probe.work.length);
console.log(calls, probe.count);
