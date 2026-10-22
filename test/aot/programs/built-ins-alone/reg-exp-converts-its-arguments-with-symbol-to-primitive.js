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
    return undefined;
  },
};
try {
  RegExp(firstProbe, secondProbe);
} catch (error) {
  console.log(error instanceof TypeError, error instanceof RangeError);
}
console.log(calls, firstProbe.count, secondProbe.count);
