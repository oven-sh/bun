let calls = 0;
const probe = {
  count: 0,
  work: String.prototype[Symbol.iterator],
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "banana";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "banana";
  },
};
const result = probe.work();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value.length, step.value, [...result].length);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.work, probe.work.length, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
