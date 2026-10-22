let calls = 0;
const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return undefined;
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "undefined";
  },
};
try {
  new RegExp(first, probe);
} catch (error) {
  console.log(error instanceof TypeError, error instanceof RangeError);
}
console.log(calls, probe.count);
