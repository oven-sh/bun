let calls = 0;
const first = new BigInt64Array([1n, 2n, 3n]);
const secondProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("secondProbe valueOf", this === secondProbe);
    return 2;
  },
  toString() {
    calls++;
    this.count++;
    console.log("secondProbe toString", this === secondProbe);
    return "2";
  },
};
const thirdProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("thirdProbe valueOf", this === thirdProbe);
    return 5n;
  },
  toString() {
    calls++;
    this.count++;
    console.log("thirdProbe toString", this === thirdProbe);
    return "5";
  },
};
const fourthProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("fourthProbe valueOf", this === fourthProbe);
    return 5n;
  },
  toString() {
    calls++;
    this.count++;
    console.log("fourthProbe toString", this === fourthProbe);
    return "5";
  },
};
const result = Atomics.compareExchange(first, secondProbe, thirdProbe, fourthProbe);
console.log(typeof result, result + 1n, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1, typeof thirdProbe.valueOf, thirdProbe.valueOf.length);
console.log(typeof thirdProbe.toString, thirdProbe.toString.length, typeof fourthProbe, Object.keys(fourthProbe).join());
console.log(typeof fourthProbe.count, fourthProbe.count + 1, typeof fourthProbe.valueOf, fourthProbe.valueOf.length);
console.log(typeof fourthProbe.toString, fourthProbe.toString.length);
console.log(calls, secondProbe.count, thirdProbe.count, fourthProbe.count);
