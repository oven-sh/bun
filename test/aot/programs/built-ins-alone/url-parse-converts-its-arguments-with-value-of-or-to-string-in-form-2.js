let calls = 0;
const firstProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("firstProbe valueOf", this === firstProbe);
    return 1.5;
  },
  toString() {
    calls++;
    this.count++;
    console.log("firstProbe toString", this === firstProbe);
    return "1.5";
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
const result = URL.parse(firstProbe, secondProbe);
console.log(result === null, typeof firstProbe, Object.keys(firstProbe).join(), typeof firstProbe.count, firstProbe.count + 1);
console.log(typeof firstProbe.valueOf, firstProbe.valueOf.length, typeof firstProbe.toString, firstProbe.toString.length, typeof secondProbe);
console.log(Object.keys(secondProbe).join(), typeof secondProbe.count, secondProbe.count + 1, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length);
console.log(calls, firstProbe.count, secondProbe.count);
