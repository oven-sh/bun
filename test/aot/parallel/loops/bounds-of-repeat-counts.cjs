// The bound of an inner loop is an element of a list of several kinds. Its counter only counts.
var settings = [true, false, 10, "x", "3", 2.5, undefined, { valueOf() { return 4; } }];
function Core(length, kind) {
  this.buffer = kind === "list" ? Array.from({ length }, (_, at) => at) : new Int32Array(length).fill(7);
  this.second = new Float32Array(length);
}
Core.prototype.output = function (which) {
  var count = 0, sample = 0, left = 0, right = 0, to = 0, divisor = settings[which], rounds = 0;
  for (var from = 0; from < this.buffer.length;) {
    for (count = left = right = 0; count < divisor; ++count) {
      sample = this.buffer[from++];
      left += sample >> 1;
      right += sample & 1;
    }
    this.second[to++] = left;
    this.second[to++] = right;
    if (++rounds > 400) break;
  }
  return from + " " + to + " " + count;
};
const unseen = (0, eval)("(function (box) { return globalThis.act ? globalThis.act(box) : 0; })");
unseen(settings);
for (const kind of ["view", "list"]) {
  for (let which = 0; which < settings.length; which++) {
    const core = new Core(100, kind);
    console.log(kind, which, core.output(which), core.second.slice(0, 24).join());
  }
}
const core = new Core(100, "view");
settings[2] = 1n;
console.log(core.output(2), core.second[0]);
settings[2] = Symbol.iterator;
try {
  console.log(core.output(2));
} catch (error) {
  console.log(error.constructor.name);
}
