// A call of a property that a getter answers calls what the getter returns. The classes below leave the file, so others may lay something else under the name.
// Under: --aot-check=FlowFixpoint: the call knew what the getter returned and gave it up where the class had left in between, and the flow was not closed.
"use strict";
const read = JSON.parse('{"first":"twice","second":"half","key":"act","absent":"nothing","negative":0,"text":"8"}');
const actions = {
  twice(value) { return value * 2; },
  half(value) { return value / 2; },
};
const negativeZero = -read.negative;

class Machine {
  get act() { return actions[read.first]; }
}
console.log(new Machine().act(21), Object.is(new Machine().act(negativeZero), -0), new Machine().act(read.text));

class Tool {
  static get act() { return actions[read.second]; }
  get run() { return actions[read.first]; }
}
console.log(Tool.act(9), new Tool().run(9), Object.is(Tool.act(negativeZero), -0));

class Base {
  get act() { return actions[read.first]; }
}
class Derived extends Base {
  get throughBase() { return super.act; }
}
const base = new Base(), derived = new Derived();
const calls = [() => base.act(10), () => derived.act(10), () => derived.throughBase(10)];
const tell = () => console.log(calls.map(call => { try { return call(); } catch (error) { return error.constructor.name; } }).join(" "));
tell();
Object.defineProperty(Base.prototype, read.key, { get: () => actions[read.second], configurable: true });
tell();
Object.defineProperty(Base.prototype, read.key, { value: read.text, configurable: true });
tell();
Object.defineProperty(Base.prototype, read.key, { value: actions.half });
tell();

class Without {
  get act() { return actions[read.absent]; }
}
try {
  console.log(new Without().act(1));
} catch (error) {
  console.log(error.constructor.name);
}

class Row {
  constructor(index) { this.index = index; }
  get act() { return this.index % 3 ? actions[read.first] : actions[read.second]; }
}
const rows = Array.from({ length: 12 }, (_, index) => new Row(index));
let total = 1;
for (let turn = 0; turn < 300; turn++) {
  for (const row of rows) total = (row.act(total) + row.index) % 65521;
}
console.log(total, JSON.stringify(rows.slice(3, 5)));
