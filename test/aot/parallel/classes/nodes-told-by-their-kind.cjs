// STATISTIC: HierarchiesExpectedByNames >= 1
// What comes first reads a name that the classes of one hierarchy alone have: any of them is expected, whatever the branches behind ask of it.
var Kind = { List: 1, Sum: 2, Leaf: 3, Not: 4, Call: 5 };
class Node { constructor(kind) { this.kind = kind; this.flags = 0; } }
class List extends Node { constructor(members) { super(Kind.List); this.members = members; } }
class Sum extends Node { constructor(left, right) { super(Kind.Sum); this.left = left; this.right = right; } }
class Leaf extends Node { constructor(value) { super(Kind.Leaf); this.value = value; } }
class Not extends Node { constructor(left) { super(Kind.Not); this.left = left; } }
class Call extends Node { constructor(callee, args) { super(Kind.Call); this.callee = callee; this.args = args; } }
var walkers = {}, on = process.argv.length;
function keep(table, key, value) { table[key] = value; }
keep(globalThis, 'kept' + on, [Node, List, Sum, Leaf, Not, Call]);
keep(walkers, 'evaluate', function (node, walk) {
  if (node.kind == Kind.List) return walk(node.members[node.members.length - 1], walk);
  else if (node.kind == Kind.Sum) return walk(node.left, walk) + walk(node.right, walk);
  else if (node.kind == Kind.Leaf) return node.value;
  else if (node.kind == Kind.Not) return -walk(node.left, walk);
  else if (node.kind == Kind.Call) return node.callee(walk(node.args, walk));
  return 'unknown ' + typeof node.kind + ' ' + node.flags;
});
keep(walkers, 'depth', function (node, walk) {
  var list = null;
  if (node.kind === Kind.List) { list = node; list.seen = true; }
  if (node.kind === Kind.Sum) return 1 + Math.max(walk(node.left, walk), walk(node.right, walk));
  if (node.kind === Kind.Not) return 1 + walk(node.left, walk);
  return list ? list.members.length : node.kind === Kind.Leaf ? 1 : 0;
});
function run(name, node) { try { return walkers[name](node, walkers[name]); } catch (error) { return error.name; } }
var tree = new List([new Leaf(1), new Sum(new Not(new Leaf(4)), new Call(x => x * 2, new Sum(new Leaf(3), new Leaf(0.5))))]);
console.log(run('evaluate', tree), run('depth', tree), tree.seen, run('depth', tree.members[1]));
var odd = [{ kind: Kind.Leaf, value: 'literal' }, { kind: Kind.Sum, left: new Leaf('a'), right: { kind: 3, value: 'b' } }, undefined, null, 3, 'text', { get kind() { return Kind.Leaf; }, value: 7 },
  Object.create(new Leaf(8)), new Proxy(new Leaf(9), {}), Object.freeze(new Leaf(10)), new Node('odd'), Object.assign(new Leaf(11), { kind: Kind.Not, left: new Leaf(12) }), class { static kind = 3; static value = 'static'; }, function () { }, []];
for (var node of odd) console.log(String(run('evaluate', node)), String(run('depth', node)));
var changed = new Leaf(13); delete changed.kind; console.log(run('evaluate', changed), run('depth', changed));
Object.defineProperty(changed, 'kind', { get() { return this.value === 13 ? Kind.Leaf : 0; }, configurable: true }); console.log(run('evaluate', changed), run('depth', changed));
Object.setPrototypeOf(changed, { kind: 1 }); console.log(run('evaluate', changed)); delete changed.kind; changed.members = [new Leaf(14)]; console.log(run('evaluate', changed), run('depth', changed));
Node.prototype.kind = Kind.Leaf; Node.prototype.value = 'above'; var bare = new Leaf(15); delete bare.kind; delete bare.value; console.log(run('evaluate', bare), run('depth', bare));
