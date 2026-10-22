let calls = 0;
const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "an";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "an";
  },
};
const result = pattern.exec(probe);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(typeof result[2], result[2].length, result[2], typeof result[3], result[3] === undefined);
console.log(typeof result.index, result.index + 1, 1 / result.index);
console.log(typeof result.input, result.input.length, result.input, typeof result.groups, Object.keys(result.groups).join());
console.log(typeof result.groups.rest, result.groups.rest.length, result.groups.rest, typeof result.groups.none, result.groups.none === undefined);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
