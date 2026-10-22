let calls = 0;
const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
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
const result = probe.work(first);
console.log(typeof result);
const step = result.next();
console.log(step.done, Array.isArray(step.value), step.value.length);
console.log(typeof step.value[0], step.value[0].length, step.value[0]);
console.log(typeof step.value[1], step.value[1].length, step.value[1]);
console.log(typeof step.value[2], step.value[2].length, step.value[2], typeof step.value[3], step.value[3] === undefined);
console.log(typeof step.value.index, step.value.index + 1, typeof step.value.input, step.value.input.length, step.value.input);
console.log(typeof step.value.groups, [...result].length, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
