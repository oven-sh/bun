let calls = 0;
const subject = new Bun.CryptoHasher("sha256");
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "-";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "-";
  },
};
const result = subject.update("banana", probe);
console.log(result === subject, typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
