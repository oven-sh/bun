let calls = 0;
const subject = Buffer.from("banana and more text, 24");
const first = new DataView(new ArrayBuffer(16));
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
const fourthProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("fourthProbe toPrimitive", hint, this === fourthProbe);
    return 4.5;
  },
};
const result = subject.copy(first, secondProbe, thirdProbe, fourthProbe);
console.log(typeof result, result + 1, first instanceof DataView, first.byteLength, first.byteOffset);
console.log(typeof secondProbe, Object.keys(secondProbe).join(), typeof secondProbe.count, secondProbe.count + 1, typeof thirdProbe);
console.log(Object.keys(thirdProbe).join(), typeof thirdProbe.count, thirdProbe.count + 1, typeof fourthProbe, Object.keys(fourthProbe).join());
console.log(typeof fourthProbe.count, fourthProbe.count + 1);
console.log(calls, secondProbe.count, thirdProbe.count, fourthProbe.count);
