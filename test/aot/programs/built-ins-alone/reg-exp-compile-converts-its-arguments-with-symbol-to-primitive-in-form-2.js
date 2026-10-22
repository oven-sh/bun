let calls = 0;
const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = pattern.compile(probe);
console.log(result === pattern, pattern instanceof RegExp, pattern.source, pattern.flags, pattern.lastIndex);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
