let calls = 0;
const subject = new EventTarget();
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1.5;
  },
};
const result = subject.removeEventListener(probe, null, 3.5);
console.log(typeof result, result === undefined);
console.log(calls);
