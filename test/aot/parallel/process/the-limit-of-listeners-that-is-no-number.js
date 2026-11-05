// A program may store anything in `process._maxListeners`, or put an accessor there: getMaxListeners answers what it finds.
for (const limit of ["2", null, 2n, { valueOf: () => 3 }, undefined]) {
  process._maxListeners = limit;
  const answer = process.getMaxListeners();
  console.log(typeof answer, answer === limit, String(answer));
}
let stored = 0;
Object.defineProperty(process, "_maxListeners", {
  get: () => stored + 1,
  set: value => {
    stored = value * 2;
  },
  configurable: true,
});
console.log(process.getMaxListeners(), process.setMaxListeners(5) === process, process.getMaxListeners());
