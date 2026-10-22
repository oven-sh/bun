let calls = 0;
const subject = new Headers({ first: "1", second: "two" });
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return "Set-Cookie";
  },
};
const result = subject.getAll(probe);
console.log(Array.isArray(result), result.length);
console.log(calls);
