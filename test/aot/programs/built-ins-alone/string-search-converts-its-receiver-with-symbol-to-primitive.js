let calls = 0;
const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const probe = {
  count: 0,
  work: String.prototype.search,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "banana";
  },
};
const result = probe.work(first);
console.log(typeof result, result + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.work, probe.work.length);
console.log(calls, probe.count);
