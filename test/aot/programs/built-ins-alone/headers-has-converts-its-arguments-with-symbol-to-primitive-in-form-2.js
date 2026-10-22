let calls = 0;
const subject = new Headers({ first: "1", second: "two" });
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1.5;
  },
};
const result = subject.has(probe);
console.log(typeof result, result, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
