let calls = 0;
const firstProbe = {
  valueOf() {
    calls++;
    console.log("firstProbe valueOf", this === firstProbe);
    return 8;
  },
  toString() {
    calls++;
    console.log("firstProbe toString", this === firstProbe);
    return "8";
  },
};
const secondProbe = {
  valueOf() {
    calls++;
    console.log("secondProbe valueOf", this === secondProbe);
    return "-";
  },
  toString() {
    calls++;
    console.log("secondProbe toString", this === secondProbe);
    return "-";
  },
};
const result = "banana".padEnd(firstProbe, secondProbe);
console.log(typeof result, result.length, result);
console.log(calls);
