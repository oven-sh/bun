let calls = 0;
const subject = Buffer.from("banana and more text, 24");
const first = new Uint8Array([1, 2, 3]);
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
const result = subject.indexOf(first, secondProbe, thirdProbe, fourthProbe);
console.log(typeof result, result + 1, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1, typeof thirdProbe.valueOf, thirdProbe.valueOf.length);
console.log(typeof thirdProbe.toString, thirdProbe.toString.length, typeof fourthProbe, Object.keys(fourthProbe).join());
console.log(typeof fourthProbe.count, fourthProbe.count + 1, typeof fourthProbe.valueOf, fourthProbe.valueOf.length);
console.log(typeof fourthProbe.toString, fourthProbe.toString.length);
console.log(calls, secondProbe.count, thirdProbe.count, fourthProbe.count);
