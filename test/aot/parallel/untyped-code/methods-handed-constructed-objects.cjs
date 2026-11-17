// Methods of constructor functions that their callers hand instances of constructor functions by name, and other values.
"use strict";
const out = [];
const show = (f) => { try { const v = f(); return v && typeof v === "object" ? v.constructor && v.constructor.name + "{" + Object.keys(v).join() + "}" : String(v); } catch (e) { return e.constructor.name; } };
var Place = function Place(line, column) { this.line = line; this.column = column; };
var Node = function () { function Node(parser, pos) { this.type = ""; this.start = pos; this.end = 0; this.loc = new Place(pos, 1); if (parser && parser.ranges) this.range = [pos, 0]; } Node.prototype.width = function () { return this.end - this.start; }; return Node; }();
var Base = function () {
  function Base(ranges) { this.ranges = ranges; this.stack = []; this.last = null; this.pos = 0; }
  var proto = Base.prototype;
  proto.startNode = function () { return new Node(this, this.pos++); };
  proto.finishNode = function (node, type) { return this.finishAt(node, type, this.pos); };
  proto.finishAt = function (node, type, pos) { node.type = type; node.end = pos; node.loc.line = pos; if (this.ranges) node.range[1] = pos; this.process(node); return node; };
  proto.process = function (node) {
    if (node.type === "Program" && node.body.length > 0) return;
    var stack = this.stack, first;
    if (stack.length > 0 && stack[stack.length - 1].start >= node.start) first = stack.pop();
    if (first) { if (first.comments) { node.comments = first.comments; first.comments = null; } else node.inner = first.end; }
    if (node.arguments && node.arguments.length) this.last = node.arguments[0].start;
    for (var i = 0; i < 2; i++) { if (node.start > i) this.last = node.end + i; }
    stack.push(node);
  };
  return Base;
}();
function Parser(ranges) { var _this; _this = Base.call(this, ranges) || this; return _this; }
Parser.prototype = Object.create(Base.prototype); Parser.prototype.constructor = Parser;
Parser.prototype.name = function () { var node = this.startNode(); node.name = "n" + this.pos; node.loc.name = node.name; return this.finishNode(node, "Name"); };
Parser.prototype.call = function (n) { var node = this.startNode(); node.arguments = []; for (var i = 0; i < n; i++) { var argument = this.name(); node.arguments.push(argument); } node.comments = n & 1 ? [n] : null; return this.finishNode(node, "Call"); };
Parser.prototype.program = function (n) { var node = this.startNode(); node.body = []; while (n-- > 0) { var statement = n & 1 ? this.call(n) : this.name(); statement.extra = n; node.body.push(statement); } return this.finishNode(node, "Program"); };
const others = [(p) => null, (p) => undefined, (p) => 7, (p) => "text", (p) => ({ type: "x", start: 2, loc: {}, range: [] }), (p) => ({ start: 1, end: 2, loc: new Place(1, 2), arguments: [{ start: 9 }] }), (p) => Object.freeze(new Node(p, 3)), (p) => new Proxy(new Node(p, 4), {}), (p) => Object.create(new Node(p, 5)), (p) => { const n = new Node(p, 6); delete n.start; return n; }, (p) => Object.defineProperty(new Node(p, 1), "type", { get() { return "got"; }, set(v) { out.push("set " + v); }, configurable: true }), (p) => [1, 2], (p) => new (class Sub extends Node { })(p, 2), (p) => { const n = new Node(p, 1); n.loc = null; return n; }, (p) => new Place(1, 2), (p) => p, (p) => new Map(), (p) => { const n = new Node(null, 2); n.type = "Program"; return n; }];
function drive(round) {
  for (const ranges of [false, true]) {
    const p = new Parser(ranges);
    out.push(show(() => JSON.stringify(p.program(4))), show(() => p.stack.length + "," + p.last));
    for (const other of others) {
      out.push(show(() => p.finishNode(other(p), "Other")), show(() => p.process(other(p))), show(() => p.finishAt(other(p), "At", 3)), show(() => p.last), show(() => p.stack.length));
    }
    out.push(show(() => JSON.stringify(p.program(3))), show(() => p.name().width()));
  }
}
for (let round = 0; round < 3; round++) { if (round === 2) Node.prototype.body = []; drive(round); }
Base.prototype.startNode = function () { return { type: "", start: 1, end: 0, loc: {}, range: [] }; };
drive(3);
for (const line of out) console.log(line);
