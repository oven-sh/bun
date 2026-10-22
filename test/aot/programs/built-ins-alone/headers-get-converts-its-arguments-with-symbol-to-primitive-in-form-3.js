let calls = 0;
const subject = new Headers({ first: "1", second: "two" });
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = subject.get(probe);
console.log(result === null);
console.log(calls);
