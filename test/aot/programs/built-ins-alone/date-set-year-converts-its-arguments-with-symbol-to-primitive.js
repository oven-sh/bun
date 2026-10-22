let calls = 0;
const date = new Date(86400000.5);
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1.5;
  },
};
const result = date.setYear(probe);
console.log(typeof result, result + 1, date instanceof Date, date.getTime(), typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
