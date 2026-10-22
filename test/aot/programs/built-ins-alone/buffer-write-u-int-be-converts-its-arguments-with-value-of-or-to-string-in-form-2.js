let calls = 0;
const subject = Buffer.from("banana and more text, 24");
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return 1.5;
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "1.5";
  },
};
const result = subject.writeUIntBE(probe, 0, 2);
console.log(typeof result, result + 1, subject instanceof Buffer, subject.length);
console.log(typeof subject[0], subject[0] + 1, 1 / subject[0], typeof subject[1], subject[1] + 1);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
