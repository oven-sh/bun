// COUNTER: operationAOTPutByIdSloppy <= 60
// A counter on a constructor function has the name of a field of other objects. Its stores are heard by nobody.
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
