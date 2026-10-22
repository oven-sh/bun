let calls = 0;
const subject = new Bun.CryptoHasher("sha256");
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "-";
  },
};
const result = subject.update("banana", probe);
console.log(result === subject, typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
