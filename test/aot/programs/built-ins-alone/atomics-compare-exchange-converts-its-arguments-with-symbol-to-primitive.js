let calls = 0;
const first = new Int16Array([1, 2, 3]);
const secondProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return 2;
  },
};
const thirdProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("thirdProbe toPrimitive", hint, this === thirdProbe);
    return 3;
  },
};
const fourthProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("fourthProbe toPrimitive", hint, this === fourthProbe);
    return 4;
  },
};
const result = Atomics.compareExchange(first, secondProbe, thirdProbe, fourthProbe);
console.log(typeof result, result + 1, first instanceof Int16Array, first.length);
console.log(typeof first[0], first[0] + 1, typeof first[1], first[1] + 1, typeof secondProbe);
console.log(Object.keys(secondProbe).join(), typeof secondProbe.count, secondProbe.count + 1, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1, typeof fourthProbe, Object.keys(fourthProbe).join());
console.log(typeof fourthProbe.count, fourthProbe.count + 1);
console.log(calls, secondProbe.count, thirdProbe.count, fourthProbe.count);
