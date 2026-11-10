// Behind a yes the fields are read off the shape that the question has tested. Beside objects of the class: one whose field was deleted and laid anew, one with a getter of its own, a frozen one,
// one made by Object.create below the class, a proxy over one, one of a class below; and a function that the build does not see changes the object between the question and the read.
// STATISTIC: QuestionsOfInstanceOfWhoseArmsEndWithBranch >= 2
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
    if (turn === 25 && event === events[2]) drop(event, "fingers");
    if (turn === 30 && event === events[5]) lay(event, KeyEvent.prototype);
    if (turn === 35 && event === events[8]) event[named("fingers")] = "many";
  },
};
const deed = deeds[JSON.parse('["change"]')[0]];
function weigh(turn) {
  const said = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event instanceof TouchEvent) {
      deed(event, turn);
      said.push(event.fingers, event.x);
    } else if (event instanceof KeyEvent) said.push(event.key);
    else said.push("-");
  }
  return said.join(" ");
}
const all = [];
for (let turn = 0; turn < 40; turn++) {
  const said = weigh(turn);
  if (all[all.length - 1] !== said) all.push(said);
}
console.log(all.join("\n"));
