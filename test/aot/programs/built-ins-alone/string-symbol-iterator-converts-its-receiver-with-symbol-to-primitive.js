let calls = 0;
const probe = {
  count: 0,
  work: String.prototype[Symbol.iterator],
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "banana";
  },
};
const result = probe.work();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value.length, step.value, [...result].length);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.work, probe.work.length);
console.log(calls, probe.count);
