let calls = 0;
const firstProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("firstProbe toPrimitive", hint, this === firstProbe);
    return 8;
  },
};
const secondProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return "-";
  },
};
const result = "banana".padEnd(firstProbe, secondProbe);
console.log(typeof result, result.length, result, typeof firstProbe, Object.keys(firstProbe).join());
console.log(typeof firstProbe.count, firstProbe.count + 1, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1);
console.log(calls, firstProbe.count, secondProbe.count);
