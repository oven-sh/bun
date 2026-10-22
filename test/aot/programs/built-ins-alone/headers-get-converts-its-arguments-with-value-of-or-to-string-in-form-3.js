let calls = 0;
const subject = new Headers({ first: "1", second: "two" });
const probe = {
  valueOf() {
    calls++;
    console.log("probe valueOf", this === probe);
    return "an";
  },
  toString() {
    calls++;
    console.log("probe toString", this === probe);
    return "an";
  },
};
const result = subject.get(probe);
console.log(result === null);
console.log(calls);
