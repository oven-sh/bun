// Classes that get many more fields than their constructors store: the end of a birth looks at the fields that a birth stores, the last of them included.
const held = [];
class Location { constructor(line) { this.line = line; this.column = line * 2; this.index = line + 0.5; } }
class Node {
  constructor(parser, pos, loc) {
    this.type = "";
    this.start = pos;
    this.end = 0;
    this.loc = new Location(loc);
    if (parser !== null && parser.ranges) this.range = [pos, 0];
    if (parser !== null && parser.keep) held.push(this);
    if (parser !== null && parser.throws === pos) throw new RangeError("at " + pos);
  }
  finish(type, end) { this.type = type; this.end = end; return this; }
}
class Extra extends Node { constructor(parser, pos, loc) { super(parser, pos, loc); this.weight = pos / 2; this.last = loc; } }
function Plain(parser, pos) { this.start = pos; this.ratio = pos / 4; if (parser !== null && parser.keep) held.push(this); Object.defineProperty(this, "hidden", { value: pos, enumerable: false, configurable: true, writable: true }); this.end = -0; }
const names = ["body", "left", "right", "operator", "argument", "prefix", "callee", "params", "id", "init", "kind", "value", "raw", "key", "computed", "shorthand", "object", "property", "optional", "test", "consequent", "alternate", "label", "block", "handler", "finalizer", "param", "source", "local", "exported"];
function body(node, n) { node.body = [n]; node.left = n; node.right = n / 2; return node; }
function call(node, n) { node.callee = node; node.params = [n, n]; node.optional = n > 2; return node; }
function binary(node, n) { node.operator = "+"; node.left = null; node.right = undefined; node.test = n; return node; }
function property(node, n) { node.key = "k" + n; node.value = n; node.computed = false; node.shorthand = true; node.kind = "init"; return node; }
function others(node, n) { for (let i = 0; i < names.length; i += 3) node[names[i]] = n; return node; }
function lines(nodes) { let sum = 0; for (const node of nodes) sum += node.loc.line + node.start; return sum; }
function weights(nodes) { let text = ""; for (const node of nodes) text += node.last + "/" + node.weight + "/" + node.loc.index + " "; return text; }
function ratios(nodes) { let sum = 0; for (const node of nodes) sum += node.ratio + node.start + node.end; return sum; }
const parsers = [null, { ranges: true, keep: false, throws: -1 }, { ranges: false, keep: true, throws: 3 }, { ranges: true, keep: true, throws: 5 }];
const show = o => Object.keys(o).map(k => k + "=" + (Array.isArray(o[k]) ? "[" + o[k].join() + "]" : typeof o[k] === "object" && o[k] ? o[k].constructor.name : Object.is(o[k], -0) ? "-0" : String(o[k]))).join();
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name + " " + error.message; } };
for (let turn = 0; turn < 6; turn++) {
  for (const parser of parsers) for (let n = 0; n < 7; n++) {
    const fill = [body, call, binary, property, others][(n + turn) % 5];
    console.log(attempt(() => show(fill(new Node(parser, n, n + turn), n).finish("T" + n, n + 1))), "|", attempt(() => show(fill(new Extra(parser, n, n), n))), "|", attempt(() => show(fill(new Plain(parser, n), n))));
  }
  console.log(held.length, held.map(o => o.constructor.name + ":" + show(o)).join(" / "));
  held.length = 0;
  for (const parser of [parsers[0], parsers[1]]) {
    const nodes = [1, 2, 4].map(n => new Node(parser, n, n)), extras = [1, 2, 4].map(n => new Extra(parser, n, n)), plains = [1, 2, 4].map(n => new Plain(parser, n));
    console.log(attempt(() => lines(nodes)), attempt(() => lines(extras)), attempt(() => weights(extras)), attempt(() => ratios(plains)), nodes.map(show).join(" "), plains.map(show).join(" "));
  }
  if (turn === 1) {
    for (const [prototype, key, value] of [[Node.prototype, "loc", { line: 70, index: 8 }], [Extra.prototype, "last", "above"], [Plain.prototype, "end", 100]]) Object.defineProperty(prototype, key, { set(v) { held.push({ key }); }, get() { return value; }, configurable: true });
  }
  if (turn === 2) { delete Node.prototype.loc; delete Extra.prototype.last; delete Plain.prototype.end; }
  if (turn === 2) Object.defineProperty(Node.prototype, "end", { set(v) { held.push({ set: v }); }, get() { return 7; }, configurable: true });
  if (turn === 3) delete Node.prototype.end;
}
