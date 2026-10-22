let calls = 0;
const probe = {
  count: 0,
  get [Symbol.toStringTag]() {
    calls++;
    this.count++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const holder = { type: probe };
try {
  new Intl.DisplayNames(1.5, holder);
} catch (error) {
  console.log(error instanceof TypeError, error instanceof RangeError);
}
console.log(calls, probe.count);
