// STATISTIC: LoadedObjectsCheckedForMarks >= 1
// A loom holds a shuttle whose fields one method lays behind its construction. What the loom reckons with it in one go asks in one test for its layout and that no mark lies on it.
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
const first = new Loom("green", 500);
Reflect.set(first, JSON.parse('"rows"'), JSON.parse("3"));
first.weave(1);
const loom = new Loom("blue", 90000).weave(400);
console.log(first.rows, first.shuttle.left, loom.rows, loom.shuttle.used, loom.shuttle.left, loom.shuttle.side, loom.shuttle.hue);
