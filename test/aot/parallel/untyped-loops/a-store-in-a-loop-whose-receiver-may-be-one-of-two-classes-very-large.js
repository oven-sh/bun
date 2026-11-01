// `while (this.active && !this.paused) { this.consumed = 0; .. }` behind `if (this.busy) return;`. The machine and its reader both have a method `write`, and both are handed to code that nobody has seen, so either may be `this` in the loop.
// Flags: --aot-limit=MaxWarmCodeValues:1
// COUNT: arrivals <= 85000
const State = { Data: 0, TagOpen: 1, TagName: 2, BeforeName: 3, Name: 4, AfterName: 5, BeforeValue: 6, Unquoted: 7, SingleQuoted: 8, AfterValue: 9, SelfClosing: 10, DoubleQuoted: 11 };

class Reader {
  constructor(listener) {
    this.text = "";
    this.listener = listener;
    this.position = -1;
    this.atEnd = false;
  }
  write(text) {
    this.text += text;
    this.atEnd = false;
  }
  advance() {
    this.position++;
    if (this.position >= this.text.length) {
      this.atEnd = true;
      return -1;
    }
    const unit = this.text.charCodeAt(this.position);
    if (unit === 0) this.listener.onProblem.call(this.listener, "null", this);
    return unit;
  }
}

class Machine {
  constructor(listener) {
    this.reader = new Reader(listener);
    this.listener = listener;
    this.state = State.Data;
    this.busy = false;
    this.active = false;
    this.paused = false;
    this.consumed = 0;
    this.tags = 0;
    this.problems = 0;
    this.name = "";
    this.attribute = { name: "", value: "" };
    this.attributes = [];
  }
  write(text) {
    this.active = true;
    this.reader.write(text);
    this.run();
  }
  run() {
    if (this.busy) return;
    this.busy = true;
    while (this.active && !this.paused) {
      this.consumed = 0;
      const unit = this.consume();
      if (!this.waits()) this.step(unit);
    }
    this.busy = false;
  }
  consume() {
    this.consumed++;
    return this.reader.advance();
  }
  waits() {
    if (this.reader.atEnd) {
      this.active = false;
      return true;
    }
    return false;
  }
  report(what) {
    this.problems++;
    this.listener.onProblem.call(this.listener, what, this);
  }
  finishAttribute() {
    this.attributes.push(this.attribute);
    this.attribute = { name: "", value: "" };
  }
  step(unit) {
    switch (this.state) {
      case State.Data: this.inData(unit); break;
      case State.TagOpen: this.inTagOpen(unit); break;
      case State.TagName: this.inTagName(unit); break;
      case State.BeforeName: this.beforeName(unit); break;
      case State.Name: this.inName(unit); break;
      case State.AfterName: this.afterName(unit); break;
      case State.BeforeValue: this.beforeValue(unit); break;
      case State.Unquoted: this.inUnquoted(unit); break;
      case State.SingleQuoted: this.inSingleQuoted(unit); break;
      case State.AfterValue: this.afterValue(unit); break;
      case State.SelfClosing: this.inSelfClosing(unit); break;
      case State.DoubleQuoted: this.inDoubleQuoted(unit); break;
      default: throw new Error("no such state");
    }
  }
  inData(unit) {
    if (unit === 60) this.state = State.TagOpen;
    else if (unit === 0) this.report("null in data");
  }
  inTagOpen(unit) {
    if (unit === 47 || unit === 33 || unit === 63) this.report("not an opening tag");
    this.name = String.fromCharCode(unit);
    this.state = State.TagName;
  }
  inTagName(unit) {
    switch (unit) {
      case 32: this.state = State.BeforeName; break;
      case 47: this.state = State.SelfClosing; break;
      case 62: this.tags++; this.state = State.Data; break;
      case 0: this.report("null in a tag name"); this.name += "�"; break;
      default: this.name += String.fromCharCode(unit);
    }
  }
  beforeName(unit) {
    switch (unit) {
      case 32: break;
      case 47: this.state = State.SelfClosing; break;
      case 62: this.tags++; this.state = State.Data; break;
      case 61: this.report("equals sign before a name"); this.attribute.name = "="; this.state = State.Name; break;
      default: this.attribute.name = String.fromCharCode(unit); this.state = State.Name;
    }
  }
  inName(unit) {
    switch (unit) {
      case 32: this.state = State.AfterName; break;
      case 61: this.state = State.BeforeValue; break;
      case 62: this.finishAttribute(); this.tags++; this.state = State.Data; break;
      case 0: this.report("null in a name"); this.attribute.name += "�"; break;
      default: this.attribute.name += String.fromCharCode(unit);
    }
  }
  afterName(unit) {
    switch (unit) {
      case 32: break;
      case 61: this.state = State.BeforeValue; break;
      case 62: this.finishAttribute(); this.tags++; this.state = State.Data; break;
      default: this.finishAttribute(); this.attribute.name = String.fromCharCode(unit); this.state = State.Name;
    }
  }
  beforeValue(unit) {
    switch (unit) {
      case 32: break;
      case 34: this.state = State.DoubleQuoted; break;
      case 39: this.state = State.SingleQuoted; break;
      case 62: this.report("no value"); this.finishAttribute(); this.tags++; this.state = State.Data; break;
      default: this.attribute.value = String.fromCharCode(unit); this.state = State.Unquoted;
    }
  }
  inUnquoted(unit) {
    switch (unit) {
      case 32: this.finishAttribute(); this.state = State.BeforeName; break;
      case 62: this.finishAttribute(); this.tags++; this.state = State.Data; break;
      case 0: this.report("null in a value"); this.attribute.value += "�"; break;
      default: this.attribute.value += String.fromCharCode(unit);
    }
  }
  inSingleQuoted(unit) {
    switch (unit) {
      case 39: this.finishAttribute(); this.state = State.AfterValue; break;
      case 0: this.report("null in a value"); this.attribute.value += "�"; break;
      case -1: this.report("the text ends in a tag"); break;
      default: this.attribute.value += String.fromCharCode(unit);
    }
  }
  afterValue(unit) {
    switch (unit) {
      case 32: this.state = State.BeforeName; break;
      case 47: this.state = State.SelfClosing; break;
      case 62: this.tags++; this.state = State.Data; break;
      default: this.report("no space between attributes"); this.state = State.BeforeName; this.beforeName(unit);
    }
  }
  inSelfClosing(unit) {
    if (unit === 62) {
      this.tags++;
      this.state = State.Data;
    } else {
      this.report("a slash in a tag");
      this.state = State.BeforeName;
      this.beforeName(unit);
    }
  }
  inDoubleQuoted(unit) {
    switch (unit) {
      case 34: this.finishAttribute(); this.state = State.AfterValue; break;
      case 0: this.report("null in a value"); this.attribute.value += "�"; break;
      case -1: this.report("the text ends in a tag"); break;
      default: this.attribute.value += String.fromCharCode(unit);
    }
  }
}

const options = JSON.parse('{ "listener": "counts" }');
const listeners = { counts: { seen: 0, onProblem(what, from) { this.seen += what.length + (from.problems ?? from.position); } } };
const listener = { ...{ onProblem: null }, ...listeners[options.listener] };
const text = `<p>text</p><img alt="home" src="${"QUJD".repeat(1000)}"><a href='x' b=c d>\0</a>`;
let total = 0;
for (let turn = 0; turn < 5; turn++) {
  const machine = new Machine(listener);
  machine.write(text);
  for (const attribute of machine.attributes) total += attribute.name.length + attribute.value.length;
  total += machine.tags * 1000 + machine.problems;
}
console.log(total, listener.seen);
