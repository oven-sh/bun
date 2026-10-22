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
const result = Bun.JSONL.parseChunk(probe, 2.5, 3.5);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.values), result.values.length);
console.log(typeof result.read, result.read + 1, typeof result.done, result.done, result.error === null);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
