let calls = 0;
const subject = Buffer.from("banana and more text, 24");
const secondProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return "-";
  },
};
const thirdProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("thirdProbe toPrimitive", hint, this === thirdProbe);
    return 3.5;
  },
};
const result = subject.ucs2Write("an", secondProbe, thirdProbe);
console.log(typeof result, result + 1, subject instanceof Buffer, subject.length);
console.log(typeof subject[0], subject[0] + 1, typeof subject[1], subject[1] + 1, 1 / subject[1]);
console.log(typeof secondProbe, Object.keys(secondProbe).join(), typeof secondProbe.count, secondProbe.count + 1, typeof thirdProbe);
console.log(Object.keys(thirdProbe).join(), typeof thirdProbe.count, thirdProbe.count + 1);
console.log(calls, secondProbe.count, thirdProbe.count);
