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
const result = new Date(firstProbe, secondProbe, thirdProbe, fourthProbe, fifthProbe, operand6Probe, operand7Probe);
console.log(result instanceof Date, typeof firstProbe, Object.keys(firstProbe).join(), typeof firstProbe.count, typeof secondProbe);
console.log(Object.keys(secondProbe).join(), typeof secondProbe.count, typeof thirdProbe, Object.keys(thirdProbe).join(), typeof thirdProbe.count);
console.log(typeof fourthProbe, Object.keys(fourthProbe).join(), typeof fourthProbe.count, typeof fifthProbe, Object.keys(fifthProbe).join());
console.log(typeof fifthProbe.count, typeof operand6Probe, Object.keys(operand6Probe).join(), typeof operand6Probe.count, typeof operand7Probe);
console.log(Object.keys(operand7Probe).join(), typeof operand7Probe.count);
console.log(calls, firstProbe.count, secondProbe.count, thirdProbe.count, fourthProbe.count, fifthProbe.count);
