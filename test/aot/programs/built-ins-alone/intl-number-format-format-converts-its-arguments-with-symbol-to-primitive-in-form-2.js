let calls = 0;
const subject = new Intl.NumberFormat("en");
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1.5;
  },
};
const result = subject.format(probe);
console.log(typeof result);
console.log(calls);
