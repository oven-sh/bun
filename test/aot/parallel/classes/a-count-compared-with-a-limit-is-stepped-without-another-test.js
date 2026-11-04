// COUNT: branches <= 29000
class Ring {
  items = new Array(16).fill(0);
  head = 0;
  size = 0;
  push(value) {
    this.items[(this.head + this.size) & 15] = value;
    if (this.size < 16) this.size++;
    else this.head = (this.head + 1) & 15;
  }
  shift() {
    const value = this.items[this.head];
    this.head = (this.head + 1) & 15;
    this.size--;
    return value;
  }
}
function fillAndDrain(turns) {
  const ring = new Ring();
  ring.push(1);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    ring.push(i);
    sum = (sum + ring.shift()) | 0;
  }
  return [sum, ring.head, ring.size];
}
console.log(fillAndDrain(2000).join(" "));

const shared = new Ring();
shared.push(1);
function turn(i) {
  shared.push(i);
  return shared.shift();
}
function turns(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + turn(i)) | 0;
  return sum;
}
console.log(turns(Number(process.env.TURNS_OF_THE_RING ?? 2000)), shared.head, shared.size);

class Meter {
  at = 0;
  constructor(at) {
    this.at = at;
  }
  upBelow(limit) {
    if (this.at < limit) this.at++;
    return this.at;
  }
  upUnlessAtOrOver(limit) {
    if (this.at >= limit) return this.at;
    this.at += 1;
    return this.at;
  }
  upWithLimitOnTheLeft(limit) {
    if (limit > this.at) this.at = this.at + 3;
    return this.at;
  }
  downAbove(limit) {
    if (this.at > limit) this.at--;
    return this.at;
  }
  downByManyAbove(limit) {
    if (limit <= this.at) this.at = this.at - 7;
    return this.at;
  }
  awayFrom(limit) {
    if (this.at < limit) this.at = limit - this.at;
    return this.at;
  }
}
function walk(start, limit, steps) {
  const meter = new Meter(start);
  const seen = [];
  for (let k = 0; k < steps; k++) seen.push(meter.upBelow(limit), meter.upUnlessAtOrOver(limit), meter.upWithLimitOnTheLeft(limit));
  for (let k = 0; k < steps; k++) seen.push(meter.downAbove(-limit), meter.downByManyAbove(-limit));
  seen.push(meter.awayFrom(limit));
  return seen.join(",");
}
console.log(walk(0, 4, 3));
console.log(walk(2147483640, 2147483647, 4));
console.log(walk(2147483640, 4294967296, 4));
console.log(walk(-2147483640, -2147483630, 4));
console.log(walk(-2147483636, 2147483648, 4));
console.log(walk(9007199254740985, 9007199254740991, 4));

class RingThatIsUndone {
  items = new Array(16).fill(0);
  head = 0;
  size = 0;
  push(value) {
    this.items[(this.head + this.size) & 15] = value;
    if (this.size < 16) this.size++;
    else this.head = (this.head + 1) & 15;
  }
}
function undone() {
  const ring = new RingThatIsUndone();
  const seen = [];
  for (let i = 0; i < 6; i++) {
    ring.push(i);
    if (i === 2) ring.size = undefined;
    if (i === 3) ring.size = 15.5;
    if (i === 4) delete ring.size;
    seen.push(String(ring.size));
  }
  return seen.join(",");
}
console.log(undone());
