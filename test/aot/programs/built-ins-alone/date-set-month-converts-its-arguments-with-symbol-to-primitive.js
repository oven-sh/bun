let calls = 0;
const date = new Date(86400000.5);
const firstProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("firstProbe toPrimitive", hint, this === firstProbe);
    return 1.5;
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
const result = date.setMonth(firstProbe, secondProbe);
console.log(typeof result, result + 1, date instanceof Date, date.getTime(), typeof firstProbe);
console.log(Object.keys(firstProbe).join(), typeof firstProbe.count, firstProbe.count + 1, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1);
console.log(calls, firstProbe.count, secondProbe.count);
