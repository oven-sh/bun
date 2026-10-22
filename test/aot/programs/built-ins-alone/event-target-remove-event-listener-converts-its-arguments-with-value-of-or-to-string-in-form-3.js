let calls = 0;
const subject = new EventTarget();
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
const result = subject.removeEventListener(probe, null, 3.5);
console.log(typeof result, result === undefined);
console.log(calls);
