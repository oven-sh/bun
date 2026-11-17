// Fields that are read, by the place that stored them first. Objects of different idioms have different names.
function Constructed(i) { this.x = i; this.y = 1; }
var constructed = []; for (var i = 0; i < 16; i++) constructed.push(new Constructed(i));
var literals = []; for (var i = 0; i < 16; i++) literals.push({ left: i, top: 1 });
function fill(o, i) { o.width = i; o.height = 1; return o; }
var filled = []; for (var i = 0; i < 16; i++) filled.push(fill({}, i));
function Initialized(i) { this.init(i); }
var Alias = Initialized; Alias.prototype.init = function (i) { this.row = i; this.column = 1; };
var initialized = []; for (var i = 0; i < 16; i++) initialized.push(new Initialized(i));
class Empty { }
function set(o, i) { o.first = i; o.last = 1; return o; }
var setLater = []; for (var i = 0; i < 16; i++) setLater.push(set(new Empty(), i));
var assigned = []; for (var i = 0; i < 16; i++) assigned.push(Object.assign({}, { start: i, end: 1 }));
var base = { low: 0, high: 1 };
var spread = []; for (var i = 0; i < 16; i++) spread.push(({ ...base, low: i }));
var parsed = []; for (var i = 0; i < 16; i++) parsed.push(JSON.parse('{"key":' + i + ',"value":1}'));
function add(o) { o.count = 1; return o; }
var added = []; for (var i = 0; i < 16; i++) added.push(add({ total: i, rest: 0 }));
function make(i) { var o = {}; ['sum', 'mean'].forEach(function (k) { o[k] = k === 'sum' ? i : 1; }); return o; }
var computed = []; for (var i = 0; i < 16; i++) computed.push(make(i));
class Options { constructor(o) { Object.assign(this, o); } }
var options = []; for (var i = 0; i < 16; i++) options.push(new Options({ depth: i, limit: 1 }));
const loops = {
  "in the constructor": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = constructed[i & 15]; s = (s + o.x + o.y) | 0; } return s; },
  "in a literal": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = literals[i & 15]; s = (s + o.left + o.top) | 0; } return s; },
  "by another function": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = filled[i & 15]; s = (s + o.width + o.height) | 0; } return s; },
  "by a method through an alias": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = initialized[i & 15]; s = (s + o.row + o.column) | 0; } return s; },
  "by the caller of a class's constructor": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = setLater[i & 15]; s = (s + o.first + o.last) | 0; } return s; },
  "by Object.assign": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = assigned[i & 15]; s = (s + o.start + o.end) | 0; } return s; },
  "by a spread": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = spread[i & 15]; s = (s + o.low + o.high) | 0; } return s; },
  "by JSON.parse": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = parsed[i & 15]; s = (s + o.key + o.value) | 0; } return s; },
  "one of them by another function": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = added[i & 15]; s = (s + o.total + o.count) | 0; } return s; },
  "under computed keys": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = computed[i & 15]; s = (s + o.sum + o.mean) | 0; } return s; },
  "by Object.assign on this": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var o = options[i & 15]; s = (s + o.depth + o.limit) | 0; } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
