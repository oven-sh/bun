// Counters in fields of objects that unseen code was given: a loop steps, stores and compares them, from the borders of int32, fractions, -0, NaN; bounds of every kind; hooks that change the counter; frozen objects and accessors. What is printed is what plain Bun prints.
// STATISTIC: ComparedSumsStayBoxed >= 1
const unseen = x => [x][JSON.parse("0")];
const lose = [x => x, x => x][JSON.parse("0")];
const log = [];
const show = p => Object.is(p, -0) ? "-0" : typeof p === "bigint" ? p + "n" : Array.isArray(p) ? "[" + p.map(show).join() + "]" : String(p);
const say = (...parts) => { log.push(parts.map(show).join(" ")); };
function Machine(limit) { this.steps = 0; this.limit = limit; }
Machine.prototype.run = function (turns) { let hits = 0; for (let i = 0; i < turns; i++) { if (++this.steps > this.limit) hits++; } return hits; };
Machine.prototype.back = function (turns) { let hits = 0; for (let i = 0; i < turns; i++) { if (--this.steps < this.limit) hits++; } return hits; };
class Clock {
  constructor(end) { this.now = 0; this.end = end; }
  tick(turns) { let late = 0; for (let i = 0; i < turns; i++) { if (++this.now >= this.end) { late++; if (late > 3) break; } } return late; }
}
function Hooked(limit) { this.steps = 0; this.limit = limit; this.hooks = []; }
Hooked.prototype.run = function (turns) { let hits = 0; for (let i = 0; i < turns; i++) { if (++this.steps > this.limit) hits++; this.hooks[i & 1].call(this, i); } return hits; };
const machine = new Machine(4), clock = new Clock(3), hooked = new Hooked(5);
lose(machine); lose(clock); lose(hooked);
hooked.hooks.push(function () { this.steps += 0.5; }, function () { });
say(machine.run(10), machine.steps, machine.back(12), machine.steps, clock.tick(5), clock.now, hooked.run(10), hooked.steps);
const starts = [0, 2147483640, -2147483645, 0.5, -0, NaN, 9007199254740985, 2147483647.5, 1e300, "7", null, undefined, true, 10n];
const bounds = [5, 2147483647, 2147483646.5, 0.75, NaN, "7", undefined, null, Infinity, -2147483640, 10n, { valueOf() { return 3; } }];
for (const start of unseen(starts)) for (const bound of unseen(bounds)) {
  machine.steps = start; machine.limit = bound; clock.now = start; clock.end = bound;
  try { say(machine.run(9), machine.steps, machine.back(3), machine.steps, clock.tick(9), clock.now); } catch (error) { say(error.name, machine.steps); }
}
const frozen = Object.freeze(lose(new Machine(1)));
try { say(frozen.run(3)); } catch (error) { say(error.name, frozen.steps); }
let held = 2147483645;
const watched = lose(new Machine(2147483649));
Object.defineProperty(watched, "steps", { get() { return held; }, set(value) { held = value; } });
say(watched.run(6), held, watched.back(2), held);
console.log(log.join("\n"));
