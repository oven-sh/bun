let calls = 0;
const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
subject.hash = probe;
console.log(typeof subject.hash, subject.hash.length, subject.hash);
console.log(calls, probe.count);
