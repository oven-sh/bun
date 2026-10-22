let calls = 0;
const subject = performance;
const firstProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("firstProbe valueOf", this === firstProbe);
    return "an";
  },
  toString() {
    calls++;
    this.count++;
    console.log("firstProbe toString", this === firstProbe);
    return "an";
  },
};
const secondProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("secondProbe valueOf", this === secondProbe);
    return 2.5;
  },
  toString() {
    calls++;
    this.count++;
    console.log("secondProbe toString", this === secondProbe);
    return "2.5";
  },
};
const result = subject.getEntriesByName(firstProbe, secondProbe);
console.log(Array.isArray(result), result.length, typeof firstProbe, Object.keys(firstProbe).join(), typeof firstProbe.count);
console.log(typeof firstProbe.valueOf, firstProbe.valueOf.length, typeof firstProbe.toString, firstProbe.toString.length, typeof secondProbe);
console.log(Object.keys(secondProbe).join(), typeof secondProbe.count, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length);
console.log(calls, firstProbe.count, secondProbe.count);
