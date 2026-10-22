let calls = 0;
const subject = Buffer.from("banana and more text, 24");
const first = new Uint8Array([1, 2, 3]);
const secondProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return 2.5;
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
const fourthProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("fourthProbe toPrimitive", hint, this === fourthProbe);
    return 4.5;
  },
};
const result = subject.lastIndexOf(first, secondProbe, thirdProbe, fourthProbe);
console.log(typeof result, result + 1, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1, typeof fourthProbe, Object.keys(fourthProbe).join());
console.log(typeof fourthProbe.count, fourthProbe.count + 1);
console.log(calls, secondProbe.count, thirdProbe.count, fourthProbe.count);
