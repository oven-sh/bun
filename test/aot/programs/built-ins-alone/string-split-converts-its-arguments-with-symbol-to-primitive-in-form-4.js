let calls = 0;
const firstProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("firstProbe toPrimitive", hint, this === firstProbe);
    return "n";
  },
};
const secondProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return 2;
  },
};
const result = "banana".split(firstProbe, secondProbe);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(calls);
