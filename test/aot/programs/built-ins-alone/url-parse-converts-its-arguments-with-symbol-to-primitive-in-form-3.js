let calls = 0;
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
const result = URL.parse(firstProbe, secondProbe);
console.log(result === null, typeof firstProbe, Object.keys(firstProbe).join(), typeof firstProbe.count, firstProbe.count + 1);
console.log(typeof secondProbe, Object.keys(secondProbe).join(), typeof secondProbe.count, secondProbe.count + 1);
console.log(calls, firstProbe.count, secondProbe.count);
