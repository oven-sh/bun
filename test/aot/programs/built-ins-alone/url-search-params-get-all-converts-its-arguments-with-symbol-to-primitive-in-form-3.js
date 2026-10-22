let calls = 0;
const subject = new URLSearchParams("first=1&second=two&first=3");
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = subject.getAll(probe);
console.log(Array.isArray(result), result.length);
console.log(calls);
