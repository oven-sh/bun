let calls = 0;
const subject = new Headers({ first: "1", second: "two" });
const probe = {
  valueOf() {
    calls++;
    console.log("probe valueOf", this === probe);
    return "Set-Cookie";
  },
  toString() {
    calls++;
    console.log("probe toString", this === probe);
    return "Set-Cookie";
  },
};
const result = subject.getAll(probe);
console.log(Array.isArray(result), result.length);
console.log(calls);
