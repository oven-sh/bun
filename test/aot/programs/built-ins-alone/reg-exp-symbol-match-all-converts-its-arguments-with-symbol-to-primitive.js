let calls = 0;
const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = pattern[Symbol.matchAll](probe);
console.log(typeof result);
const step = result.next();
console.log(step.done, Array.isArray(step.value), step.value.length);
console.log(typeof step.value[0], step.value[0].length, step.value[0]);
console.log(typeof step.value[1], step.value[1].length, step.value[1]);
console.log(typeof step.value[2], step.value[2].length, step.value[2], typeof step.value[3], step.value[3] === undefined);
console.log(typeof step.value.index, step.value.index + 1, 1 / step.value.index);
console.log(typeof step.value.input, step.value.input.length, step.value.input, typeof step.value.groups, [...result].length);
console.log(typeof probe, Object.keys(probe).join());
console.log(calls, probe.count);
