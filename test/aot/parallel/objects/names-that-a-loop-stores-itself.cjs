// A loop asks objects of several classes for a name that only the loop stores: none of the classes has it as a field. It is there on the second way through, and stays what it was when a class, a prototype or a frozen object says otherwise.
const held = JSON.parse("{}"), name = text => text + process.argv.length % 1;
class Post { constructor(id) { this.id = id; } }
class Wire { constructor(id) { this.id = id; this.length = id * 2; } }
class Gate extends Post { constructor(id) { super(id); this.open = id % 2 === 0; } }
held[name("number")] = function number(list) { let next = 0, seen = 0; for (let turn = 0; turn < 2; turn++) for (let k = 0; k < list.length; k++) { const one = list[k]; if (one.mark === undefined) one.mark = next++; else seen += one.mark; } return next + "/" + seen; };
held[name("group")] = function group(list) { const groups = []; for (const one of list) { if (one.group) { one.group.push(one.id); continue; } one.group = [one.id]; groups.push(one.group); } return groups.map(list => list.join("+")).join(); };
held[name("chain")] = function chain(list) { let text = ""; for (let k = 1; k < list.length; k++) { list[k].before = list[k - 1]; if (list[k].before.before) text += list[k].before.before.id; text += list[k].visited ? "!" : "."; list[k].visited = true; } return text; };
const sets = {
  posts: () => [new Post(1), new Post(2), new Post(3)], mixed: () => [new Post(1), new Wire(2), new Gate(3), new Gate(4)], twice: () => { const post = new Post(5); return [post, new Wire(6), post, post]; }, plain: () => [{ id: 1 }, { id: 2, mark: 10 }, Object.create({ mark: 5, id: 7 })], frozen: () => [new Post(1), Object.freeze(new Wire(2)), new Gate(3)], sealed: () => [Object.seal(new Post(1)), new Post(2)],
  above: () => [Object.setPrototypeOf(new Post(8), Object.create(Post.prototype, { mark: { value: 3, writable: false } })), new Post(9)], accessor: () => [Object.defineProperty(new Post(1), "mark", { get() { return this.kept; }, set(value) { this.kept = value + 100; } }), new Wire(2)], nothing: () => [], primitives: () => [1, "text", true, new Post(1)], nulls: () => [new Post(1), null, new Post(2)], lists: () => [[], [1], Object.assign([], { id: 4 })], functions: () => [() => 1, function two() {}, class Three {}], proxy: () => [new Proxy(new Post(1), {}), new Post(2)], dictionary: () => { const one = new Post(3); delete one.id; return [one, new Post(4)]; },
};
const lines = [];
for (let round = 0; round < 4; round++) {
  for (const kind of Object.keys(sets)) for (const form of ["number", "group", "chain"]) { const list = sets[kind](); let answer; try { answer = held[name(form)](list); } catch (error) { answer = error.constructor.name; } lines.push([round, kind, form, answer, list.map(one => (one && typeof one === "object" ? Object.keys(one).join(".") : typeof one)).join("|")].join(" ")); }
  if (round === 1) Post.prototype.visited = false;
  if (round === 2) Object.defineProperty(Wire.prototype, "group", { get() { return this.kept; }, set(value) { this.kept = value; }, configurable: true });
}
console.log(lines.join("\n"));
