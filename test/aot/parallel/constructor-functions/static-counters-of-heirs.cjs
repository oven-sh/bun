// A counter on a constructor function that has heirs and objects below it, and that is defined anew, frozen and deleted.
var Context = (function () { function Context(type, id) { this.type = type; this.id = id; } return Context; })();
var Stack = (function () {
  function Stack() { this.list = []; }
  Stack.id = 8;
  Stack.prototype.push = function (type) { this.list.push(new Context(type, Stack.id++)); };
  Stack.prototype.pop = function () { return this.list.pop(); };
  return Stack;
})();
function Table() { this.n = 0; }
Table.prototype.keep = function (key, value) { this[key] = value; };
var table = new Table();
table.keep('k' + process.argv.length, new Stack());
table.keep('l' + process.argv.length, Stack);
function run(count) { var stack = new Stack(), s = 0; for (var i = 0; i < count; i++) { stack.push(i); s += stack.pop().id & 1; } return s; }
console.log(run(0), run(1), run(400), Stack.id);
class Heir extends Stack {}
console.log(Heir.id, Object.hasOwn(Heir, 'id')); run(3); console.log(Heir.id); Heir.id++; run(2); console.log(Heir.id, Stack.id);
var below = Object.create(Stack); console.log(below.id); run(1); console.log(below.id);
Object.defineProperty(Stack, 'id', { get: function () { return 5; }, set: function (id) { table.seen = id; }, configurable: true });
console.log(run(3), Stack.id, table.seen, Heir.id);
Object.defineProperty(Stack, 'id', { value: 3, writable: false, configurable: true }); console.log(run(3), Stack.id);
delete Stack.id; console.log(run(2), Stack.id); Stack.id = 'a'; console.log(run(2), Stack.id); Stack.id = 1n; console.log(Stack.id++, Stack.id);
Stack.id = 1; Object.freeze(Stack); console.log(run(4), Stack.id);
