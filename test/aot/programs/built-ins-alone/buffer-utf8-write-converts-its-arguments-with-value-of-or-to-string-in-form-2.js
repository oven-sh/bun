let calls = 0;
const subject = Buffer.from("banana and more text, 24");
const secondProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("secondProbe valueOf", this === secondProbe);
    return "-";
  },
  toString() {
    calls++;
    this.count++;
    console.log("secondProbe toString", this === secondProbe);
    return "-";
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
const result = subject.utf8Write("an", secondProbe, thirdProbe);
console.log(typeof result, result + 1, subject instanceof Buffer, subject.length);
console.log(typeof subject[0], subject[0] + 1, typeof subject[1], subject[1] + 1, typeof secondProbe);
console.log(Object.keys(secondProbe).join(), typeof secondProbe.count, secondProbe.count + 1, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1, typeof thirdProbe.valueOf, thirdProbe.valueOf.length);
console.log(typeof thirdProbe.toString, thirdProbe.toString.length);
console.log(calls, secondProbe.count, thirdProbe.count);
