let calls = 0;
const subject = new Uint8Array([1, 2, 3]);
const firstProbe = {
  valueOf() {
    calls++;
    console.log("firstProbe valueOf", this === firstProbe);
    return 1;
  },
  toString() {
    calls++;
    console.log("firstProbe toString", this === firstProbe);
    return "1";
  },
};
const secondProbe = {
  valueOf() {
    calls++;
    console.log("secondProbe valueOf", this === secondProbe);
    return 2;
  },
  toString() {
    calls++;
    console.log("secondProbe toString", this === secondProbe);
    return "2";
  },
};
const result = subject.slice(firstProbe, secondProbe);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(calls);
