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
subject.pathname = probe;
console.log(typeof subject.pathname, subject.pathname.length, subject.pathname);
console.log(calls, probe.count);
