let calls = 0;
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return 16;
  },
};
const result = (1.5).toString(probe);
console.log(typeof result, result.length, result);
console.log(calls);
