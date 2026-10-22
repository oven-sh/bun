let calls = 0;
const firstProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("firstProbe toPrimitive", hint, this === firstProbe);
    return 8;
  },
};
const secondProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return "-";
  },
};
const result = "banana".padStart(firstProbe, secondProbe);
console.log(typeof result, result.length, result);
console.log(calls);
