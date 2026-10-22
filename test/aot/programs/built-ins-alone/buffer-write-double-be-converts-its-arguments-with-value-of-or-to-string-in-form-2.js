let calls = 0;
const subject = Buffer.from("banana and more text, 24");
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
const result = subject.writeDoubleBE(probe, 2);
console.log(typeof result, result + 1, subject instanceof Buffer, subject.length);
console.log(typeof subject[0], subject[0] + 1, typeof subject[1], subject[1] + 1);
console.log(calls);
