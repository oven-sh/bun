let calls = 0;
const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const probe = {
  count: 0,
  work: String.prototype.split,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "banana";
  },
};
const result = probe.work(first);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(typeof result[2], result[2].length, result[2], typeof result[3], result[3] === undefined);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.work, probe.work.length);
console.log(calls, probe.count);
