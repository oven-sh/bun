let calls = 0;
const subject = performance;
const firstProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("firstProbe toPrimitive", hint, this === firstProbe);
    return "an";
  },
};
const secondProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return 2.5;
  },
};
const result = subject.getEntriesByName(firstProbe, secondProbe);
console.log(Array.isArray(result), result.length, typeof firstProbe, Object.keys(firstProbe).join(), typeof firstProbe.count);
console.log(typeof secondProbe, Object.keys(secondProbe).join(), typeof secondProbe.count);
console.log(calls, firstProbe.count, secondProbe.count);
