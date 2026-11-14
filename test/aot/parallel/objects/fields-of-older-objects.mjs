// A base constructor answers an older object: the fields of the heir are defined on that one. A read before the construction keeps nothing.
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
const shared = new Vector(4, 5);
class Back {
  constructor() {
    return shared;
  }
}
class Heir extends Back {
  x = 77;
}
function read(vector) {
  const before = vector.x;
  new Heir();
  return before + " " + vector.x;
}
console.log(read(shared));

class Point {
  constructor(x) {
    this.x = x;
  }
}
const points = [new Point(1), new Point(2)];
let next = 0;
class Next {
  constructor() {
    return points[next++ % 2];
  }
}
class Marked extends Next {
  ["x"] = 50;
  mark = next;
}
function construct() {
  new Marked();
}
function readInLoop(point) {
  let text = "";
  for (let i = 0; i < 3; i++) {
    text += point.x + ",";
    construct();
  }
  return text + point.x;
}
console.log(readInLoop(points[0]), readInLoop(points[1]), JSON.stringify(points));

class End {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
class Segment {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }
}
const end = new End(4, 5);
class BackToEnd {
  constructor() {
    return end;
  }
}
class HeirOfEnd extends BackToEnd {
  x = 77;
}
const factors = [3, 1.5, 0, 9];
function leadsToHeir(turn) {
  if (turn) new HeirOfEnd();
}
function middle(segment, turn) {
  const before = segment.from.x;
  leadsToHeir(turn);
  let total = 0;
  for (const factor of factors) total += segment.from.x * factor;
  return before + " " + total + " " + segment.from.x;
}
function walk(segment, turn) {
  let text = "";
  for (const factor of factors) text += factor < segment.to.x ? middle(segment, turn) : segment.to.y;
  return text + segment.from.x;
}
for (let turn = 1; turn < 4; turn++) console.log(walk(new Segment(end, new End(turn * 2, 1)), turn));

class Given {
  constructor(object) {
    return object;
  }
}
class Counted extends Given {
  count = this.count + 1;
}
class Counter {
  count = 0;
}
const counter = new Counter();
function count(object) {
  const before = object.count;
  new Counted(object);
  return before + " " + object.count;
}
console.log(count(counter), count(counter));
