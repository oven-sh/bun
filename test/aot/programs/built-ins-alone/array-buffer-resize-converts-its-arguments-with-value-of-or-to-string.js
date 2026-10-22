let calls = 0;
const subject = new ArrayBuffer(8, { maxByteLength: 16 });
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return 1;
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "1";
  },
};
const result = subject.resize(probe);
console.log(typeof result, result === undefined, subject instanceof ArrayBuffer, subject.byteLength, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
