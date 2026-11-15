// `extra` is listed by State alone; nodes are given it late, through parameters that callers hand nodes. What lies on the stack is read by that name.
const out = [];
class State {
  init(at) { this.stack = []; this.extra = { raw: "r" + at }; this.start = at; return this; }
  clone(skipArrays) { const state = new State; for (const key in this) { let val = this[key]; if (!skipArrays && Array.isArray(val)) val = val.slice(); state[key] = val; } return state; }
}
class Node {
  constructor(at) { this.loc = { at }; this.start = at; this.end = at + 5; }
  copy() { const node = new Node; for (const key in this) if (key.length < 99) node[key] = this[key]; return node; }
}
const options = {}; for (const key of ["ranges", "file" + "name"]) options[key] = key.length > 6 ? undefined : false;
function Parser(at) { this.state = new State().init(at); this.options = options; }
Parser.prototype.look = function (i) { const old = this.state; this.state = old.clone(i % 2); const n = this.finish(this.startNode(i), i); this.state = old; return n; };
Parser.prototype.startNode = function (i) { return new Node(i); };
Parser.prototype.finish = function (node, i) {
  let n = 0;
  if (i % 4) node.extra = { raw: "r" + i };
  const top = this.state.stack[this.state.stack.length - 1];
  if (this.state.stack.length > 0 && top.extra) { n += String(top.extra.raw).length; top.extra = null; }
  this.state.stack.push(node);
  if (this.state.stack.length > 9) this.state.stack.length = 4;
  return n;
};
function run(turns, first) { const p = new Parser(first); let s = 0; for (let i = first; i < first + turns; i++) s = (s * 31 + p.finish(new Node(i).copy(), i)) | 0; return s + " " + p.state.stack.length; }
for (const turns of [1, 5, 40, 700]) out.push(run(turns, 0), run(turns, 3));
out.push(new Parser(4).look(3));
try { const p = new Parser(1); p.state = new Node(7); p.state.stack = [new State().init(1)]; out.push(p.finish(new Node(1), 2), Object.keys(p.state).join()); } catch (e) { out.push(e.constructor.name); }
for (const turns of [3, 90]) out.push(run(turns, 1));
for (const line of out) console.log(String(line));
