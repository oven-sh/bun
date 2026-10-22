let calls = 0;
const subject = new Uint8Array([1, 2, 3]);
const firstProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("firstProbe toPrimitive", hint, this === firstProbe);
    return 1;
  },
};
const secondProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return 2;
  },
};
const result = subject.slice(firstProbe, secondProbe);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(calls);
