let calls = 0;
const first = new BigInt64Array([1n, 2n, 3n]);
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
    return 5n;
  },
};
const result = Atomics.sub(first, secondProbe, thirdProbe);
console.log(typeof result, result + 1n, first instanceof BigInt64Array, first.length);
console.log(typeof first[0], first[0] + 1n, typeof first[1], first[1] + 1n, typeof secondProbe);
console.log(Object.keys(secondProbe).join(), typeof secondProbe.count, secondProbe.count + 1, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1);
console.log(calls, secondProbe.count, thirdProbe.count);
