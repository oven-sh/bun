let calls = 0;
const firstProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("firstProbe toPrimitive", hint, this === firstProbe);
    return 1.5;
  },
};
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
const fifthProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("fifthProbe toPrimitive", hint, this === fifthProbe);
    return 5.5;
  },
};
const operand6Probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("operand6Probe toPrimitive", hint, this === operand6Probe);
    return 6.5;
  },
};
const operand7Probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("operand7Probe toPrimitive", hint, this === operand7Probe);
    return 7.5;
  },
};
const result = Date.UTC(firstProbe, secondProbe, thirdProbe, fourthProbe, fifthProbe, operand6Probe, operand7Probe);
console.log(typeof result, result + 1, typeof firstProbe, Object.keys(firstProbe).join());
console.log(typeof firstProbe.count, firstProbe.count + 1, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1, typeof fourthProbe, Object.keys(fourthProbe).join());
console.log(typeof fourthProbe.count, fourthProbe.count + 1, typeof fifthProbe, Object.keys(fifthProbe).join());
console.log(typeof fifthProbe.count, fifthProbe.count + 1, typeof operand6Probe, Object.keys(operand6Probe).join());
console.log(typeof operand6Probe.count, operand6Probe.count + 1, typeof operand7Probe, Object.keys(operand7Probe).join());
console.log(typeof operand7Probe.count, operand7Probe.count + 1);
console.log(calls, firstProbe.count, secondProbe.count, thirdProbe.count, fourthProbe.count, fifthProbe.count);
