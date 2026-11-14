// Variables of a CommonJS file that hold integers computed from others, and the orders in which they do not.
const no = process.argv.length > 100;
const out = [];
function say(...values) { out.push(values.map(value => Object.is(value, -0) ? "-0" : String(value)).join(" ")); }
function early() { return [typeof LATE, LATE, BOTH].join(); }
say(early());
var RUNNABLE = 1;
var SUSPENDED = 2;
var HELD = 4;
var BOTH = RUNNABLE | SUSPENDED;
var NOT_HELD = ~HELD;
var MASK = BOTH & ~RUNNABLE | HELD;
var SHIFTED = HELD << 3 | RUNNABLE;
var SIGN = 1 << 31;
var BACK = SIGN >> 31;
var SUM = SHIFTED + BOTH - HELD;
var WIDE = 0x7fffffff + RUNNABLE;
var LATE = SUM ^ BOTH;
var BEFORE = AFTER | 1;
var AFTER = 8;
var MIXED = AGAIN | (AGAIN = 6, 1);
var AGAIN;
var SELDOM = no ? 1 : 16;
var FROM_SELDOM = SELDOM | HELD;
if (no) var NEVER = 32;
var FROM_NEVER = NEVER | HELD;
for (let turn = 0; turn < 3; turn++) var LOOPED = turn | HELD;
var FROM_LOOPED = LOOPED | RUNNABLE;
try { if (!no) throw 1; var THROWN = 64; } catch { }
var FROM_THROWN = THROWN | HELD;
let BLOCK = HELD | 8;
const FIXED = BLOCK | SUSPENDED;
say(early(), BOTH, NOT_HELD, MASK, SHIFTED, SIGN, BACK, SUM, WIDE, LATE, BEFORE, AFTER, MIXED, AGAIN, FROM_SELDOM, FROM_NEVER, LOOPED, FROM_LOOPED, FROM_THROWN, FIXED);

function Task(state, id) { this.state = state; this.id = id; this.links = [10, 20.5, "text", , null, 60]; }
Task.prototype.step = function () {
  if (this.state === BOTH) this.state = HELD;
  else if ((this.state & MASK) !== 0) this.state &= NOT_HELD;
  else this.state |= BOTH;
  switch (this.state) { case BOTH: return "both"; case HELD: return "held"; case SUSPENDED: return "suspended"; default: return this.state; }
};
Task.prototype.follow = function (id) { const link = this.links[this.id]; this.id = id; return link; };
const task = new Task(0, null);
for (let turn = 0; turn < 12; turn++) say(task.step());
for (const id of [0, 1, 2, 3, 4, 5, 6, -1, null, 0x7fffffff, 1]) say(task.follow(id));
console.log(out.join("\n"));
