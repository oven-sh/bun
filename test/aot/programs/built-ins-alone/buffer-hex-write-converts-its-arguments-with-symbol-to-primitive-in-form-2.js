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
const result = subject.hexWrite("an", secondProbe, thirdProbe);
console.log(typeof result, result + 1, 1 / result, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1);
console.log(calls, secondProbe.count, thirdProbe.count);
