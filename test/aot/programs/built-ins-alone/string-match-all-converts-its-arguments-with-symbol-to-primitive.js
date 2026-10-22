let calls = 0;
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1.5;
  },
};
const result = "banana".matchAll(probe);
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value === undefined, [...result].length, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
