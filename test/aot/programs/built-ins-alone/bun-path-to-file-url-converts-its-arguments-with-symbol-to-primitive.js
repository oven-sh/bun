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
const result = Bun.pathToFileURL(probe);
console.log(result instanceof URL, typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(calls, probe.count);
