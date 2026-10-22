let calls = 0;
const probe = {
  count: 0,
  work: String.prototype.matchAll,
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
const result = probe.work(1.5);
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value === undefined, [...result].length, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1, typeof probe.work, probe.work.length);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
