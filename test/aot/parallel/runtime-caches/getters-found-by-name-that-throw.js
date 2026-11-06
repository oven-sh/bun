// A getter that throws, at the first read and after many that did not: the error, its message, who catches it, `finally`, and the names in its stack.
function getterFor(limit) {
  let calls = 0;
  return function countedGetter() {
    if (++calls > limit) throw new RangeError("call " + calls + " of " + limit);
    return calls;
  };
}
function make(limit) {
  const made = Object.create(null);
  Object.defineProperty(made, "counted", { get: getterFor(limit), configurable: true });
  return made;
}
function read(object) { return object.counted; }
function readGuarded(object) {
  try { return "value " + object.counted; } catch (error) { return "caught " + error.message; } finally { finished++; }
}
let finished = 0;
const log = [];
const atOnce = make(0);
log.push(readGuarded(atOnce), readGuarded(atOnce));
const later = make(40);
let sum = 0;
try { for (;;) sum += read(later); } catch (error) {
  log.push(error.constructor.name + " " + error.message + " " + sum);
  log.push(error.stack.split("\n").slice(1, 4).map(line => line.trim().replace(/\(.*\)|(?:[A-Z]:)?[\\\/].*/, "").trim()).join(" < "));
}
log.push(readGuarded(later), String(finished));
const thrower = Object.create(null);
Object.defineProperty(thrower, "counted", { get() { throw "no error object"; } });
try { read(thrower); } catch (thrown) { log.push(typeof thrown + " " + thrown); }
console.log(log.join("\n"));
