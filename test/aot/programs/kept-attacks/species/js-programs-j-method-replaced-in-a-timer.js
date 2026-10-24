// Species: js programs j method replaced in a timer. It prints what plain Bun prints.
const log = [];
class Meter { measure() { return "first"; } }
setTimeout(back => {
  Object.getPrototypeOf(back).measure = function () { return "replaced"; };
  log.push(new Meter().measure());
  console.log(log.join("; "));
}, 1, new Meter());
