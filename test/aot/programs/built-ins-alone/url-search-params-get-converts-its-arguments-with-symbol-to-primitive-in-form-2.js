let calls = 0;
const subject = new URLSearchParams("first=1&second=two&first=3");
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1.5;
  },
};
const result = subject.get(probe);
console.log(result === null, typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
