// Behind a yes a function that the build does not see lays the object below another class; then the same question is asked of it again, and its fields are read.
// The questions stand in an inner loop that takes its value in the turn that asks.
// STATISTIC: InstanceOfTestsJumpThreaded >= 3
class UiEvent { constructor(x) { this.x = x; } }
class TouchEvent extends UiEvent { constructor(x) { super(x); this.fingers = 2; } }
class PenEvent extends TouchEvent { constructor(x) { super(x); this.tilt = 5; } }
class KeyEvent extends UiEvent { constructor(x) { super(x); this.key = "k" + x; } }
const sizes = JSON.parse("[1,2,3,4,5,6,7,8,9,10]");
const events = sizes.map((x, i) => (i % 3 === 0 ? new TouchEvent(x) : i % 3 === 1 ? new KeyEvent(x) : new PenEvent(x)));
const named = text => JSON.parse('"' + text + '"');
const drop = Reflect[named("deleteProperty")], define = Object[named("defineProperty")], freeze = Object[named("freeze")], lay = Object[named("setPrototypeOf")];
drop(events[0], "fingers");
events[0][named("fingers")] = 7;
define(events[3], "fingers", { get() { return this.x * 100; } });
freeze(events[6]);
drop(events[9], "x");
const made = Object.create(TouchEvent.prototype);
made.fingers = 11;
made.x = 13;
events.push(made, new Proxy(new TouchEvent(17), {}), Object.create(KeyEvent.prototype), { fingers: 1, x: 1 });
const deeds = {
  quiet() {},
  change(event, turn) {
    if (turn === 25 && event === events[2]) lay(event, KeyEvent.prototype);
  },
};
const deed = deeds[JSON.parse('["change"]')[0]];
const rounds = JSON.parse("[3]")[0];
function weigh(turn) {
  const said = [];
  for (let i = 0; i < events.length; i++) {
    for (let round = 0; round < rounds; round++) {
    const event = events[i];
    if (event instanceof TouchEvent) {
      deed(event, turn);
      if (event instanceof TouchEvent) said.push("still", event.fingers); else said.push("gone");
      said.push(typeof event.fingers, event.fingers, typeof event.x, event.x);
    } else if (event instanceof KeyEvent) said.push(event.key);
    else said.push("-");
    }
  }
  return said.join(" ");
}
const all = [];
for (let turn = 0; turn < 40; turn++) {
  const said = weigh(turn);
  if (all[all.length - 1] !== said) all.push(said);
}
console.log(all.join("\n"));
