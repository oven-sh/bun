// What compiled code relies on can't be replaced, whoever tries. A store of the value that a member holds changes nothing, so it succeeds: also where the value is an equal text that
// somebody has put together. A package marked --external is interpreted, and every store it makes here is such a one: nothing is thrown with or without the lock.
// Flags: --external outside-package
const outside = require("outside-package");
const print = console.log;
const show = () =>
  [typeof process.platform, process.platform.length > 2, typeof process.arch, process.arch.length > 2].join(" ");
print("before:", show());
for (const line of outside.storeEqualTexts()) print(line);
print("after:", show());
