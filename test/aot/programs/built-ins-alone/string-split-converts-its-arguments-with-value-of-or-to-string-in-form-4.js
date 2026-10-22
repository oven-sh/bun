let calls = 0;
const firstProbe = {
  valueOf() {
    calls++;
    console.log("firstProbe valueOf", this === firstProbe);
    return "n";
  },
  toString() {
    calls++;
    console.log("firstProbe toString", this === firstProbe);
    return "n";
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
const result = "banana".split(firstProbe, secondProbe);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(calls);
