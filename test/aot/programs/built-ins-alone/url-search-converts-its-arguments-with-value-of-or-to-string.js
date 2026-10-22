let calls = 0;
const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "an";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "an";
  },
};
subject.search = probe;
console.log(typeof subject.search, subject.search.length, subject.search);
console.log(calls, probe.count);
