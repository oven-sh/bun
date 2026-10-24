function Emitter(limit) {
  this.events = 0;
  this.limit = limit;
}
Emitter.prototype.emit = function () {
  this.events = this.events + 1;
  return this.events <= this.limit;
};
class Stream extends Emitter {
  constructor(limit, size) {
    super(limit);
    this.size = size;
  }
  push() {
    return this.emit() ? this.size : 0;
  }
}
class File extends Stream {
  constructor(size) {
    super(3, size);
    this.open = 1;
  }
}
let sum = 0;
for (let i = 0; i < 100; i++) {
  const s = new Stream(2, i);
  const f = new File(i);
  const e = new Emitter(1);
  sum += s.push() + s.push() + s.push() + f.push() + f.open + (e.emit() ? 1 : 0) + e.events + s.events + f.limit;
}
console.log(sum);
