let calls = 0;
const date = new Date(86400000.5);
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
const thirdProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("thirdProbe valueOf", this === thirdProbe);
    return 3.5;
  },
  toString() {
    calls++;
    this.count++;
    console.log("thirdProbe toString", this === thirdProbe);
    return "3.5";
  },
};
const fourthProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("fourthProbe valueOf", this === fourthProbe);
    return 4.5;
  },
  toString() {
    calls++;
    this.count++;
    console.log("fourthProbe toString", this === fourthProbe);
    return "4.5";
  },
};
const result = date.setHours(firstProbe, secondProbe, thirdProbe, fourthProbe);
console.log(typeof result, result + 1, date instanceof Date, date.getTime(), typeof firstProbe);
console.log(Object.keys(firstProbe).join(), typeof firstProbe.count, firstProbe.count + 1, typeof firstProbe.valueOf, firstProbe.valueOf.length);
console.log(typeof firstProbe.toString, firstProbe.toString.length, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1, typeof thirdProbe.valueOf, thirdProbe.valueOf.length);
console.log(typeof thirdProbe.toString, thirdProbe.toString.length, typeof fourthProbe, Object.keys(fourthProbe).join());
console.log(typeof fourthProbe.count, fourthProbe.count + 1, typeof fourthProbe.valueOf, fourthProbe.valueOf.length);
console.log(typeof fourthProbe.toString, fourthProbe.toString.length);
console.log(calls, firstProbe.count, secondProbe.count, thirdProbe.count, fourthProbe.count);
