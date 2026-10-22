let calls = 0;
const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
const probe = {
  valueOf() {
    calls++;
    console.log("probe valueOf", this === probe);
    return 1.5;
  },
  toString() {
    calls++;
    console.log("probe toString", this === probe);
    return "1.5";
  },
};
const result = subject.format(probe);
console.log(typeof result);
console.log(calls);
