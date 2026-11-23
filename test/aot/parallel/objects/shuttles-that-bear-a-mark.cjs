// The same loom with a shuttle that is frozen, sealed, not threaded, half threaded, of another prototype, no shuttle at all, or that changes while it is thrown.
"use strict";
class Shuttle {
  thread(hue, length) {
    this.hue = hue;
    this.left = length;
    this.used = 0;
    this.side = 0;
  }
}
class Loom {
  constructor(hue, length) {
    const shuttle = new Shuttle();
    shuttle.thread(hue, length);
    this.rows = 0;
    this.shuttle = shuttle;
  }
  throwOver(width) {
    this.shuttle.used = this.shuttle.used + width;
    this.shuttle.left = this.shuttle.left - width;
    this.shuttle.side = 1 - this.shuttle.side;
    this.rows += this.shuttle.side;
  }
  weave(rows) {
    for (let row = 0; row < rows; row++) for (let strip = 1; strip < 8; strip++) this.throwOver(strip * 2);
    return this;
  }
}
function note(loom, name, value) {
  Reflect.set(loom, name, value);
  return loom;
}
const name = JSON.parse('"shuttle"');
for (let round = 0; round < 30; round++) note(new Loom("green", 500), JSON.parse('"rows"'), round).weave(1);
const threaded = () => {
  const shuttle = new Shuttle();
  shuttle.thread("grey", 300);
  return shuttle;
};
const shuttles = {
  frozen: () => Object.freeze(threaded()),
  sealed: () => Object.seal(threaded()),
  closed: () => Object.preventExtensions(threaded()),
  bare: () => new Shuttle(),
  half: () => Object.assign(new Shuttle(), { left: 5 }),
  lost: () => {
    const shuttle = threaded();
    delete shuttle.used;
    return shuttle;
  },
  other: () => Object.setPrototypeOf(threaded(), { get used() { return 100; }, tail: 1 }),
  alone: () => Object.setPrototypeOf(threaded(), null),
  asked: () => Object.defineProperty(threaded(), "left", { get: () => 9, set: () => {}, configurable: true }),
  record: () => ({ hue: "x", left: 10, used: "2", side: 0.5 }),
  proxy: () => new Proxy(threaded(), {}),
  text: () => "shuttle",
  none: () => null,
};
for (const [kind, made] of Object.entries(shuttles)) {
  const loom = note(new Loom("green", 500), name, made());
  let ended = "woven";
  try {
    loom.weave(2);
  } catch (error) {
    ended = error.constructor.name;
  }
  console.log(kind, ended, loom.rows, String(JSON.stringify(loom.shuttle)));
}
class Swapping extends Loom {
  throwOver(width) {
    if (width === 8) this.shuttle = this.rows & 1 ? { left: 0.5, used: "t", side: null } : Object.freeze(threaded());
    super.throwOver(width);
  }
}
for (const rows of [0, 1]) {
  const swapping = note(new Swapping("green", 500), JSON.parse('"rows"'), rows);
  try {
    swapping.weave(1);
  } catch (error) {
    console.log(error.constructor.name);
  }
  console.log(swapping.rows, JSON.stringify(swapping.shuttle));
}
Object.defineProperty(Shuttle.prototype, "used", { get: () => 7, set(value) { this.seen = value; }, configurable: true });
const late = new Shuttle();
late.thread("late", 300);
const loom = note(new Loom("green", 500), name, late).weave(1);
console.log(loom.rows, JSON.stringify(late), late.used);
