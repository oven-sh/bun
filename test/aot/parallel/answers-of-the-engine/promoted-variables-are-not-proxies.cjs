// Constants of a scope that becomes a set of variables are read in loops beside constants of the file.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.columns = factory();
})(this, function () {
  function Parser() { this.x = 1; }
  Parser.fail = {};
  function Column(i) { this.index = i; this.states = []; this.completed = {}; }
  Column.prototype.process = function () {
    var states = this.states, completed = this.completed;
    for (var w = 0; w < states.length; w++) {
      var s = states[w];
      if (s.done) {
        if (s.data !== Parser.fail) { var exp = s.name; (this.completed[exp] = this.completed[exp] || []).push(s); }
      } else if (completed.hasOwnProperty(s.name)) {
        var nulls = completed[s.name];
        for (var i = 0; i < nulls.length; i++) s.n += nulls[i].n;
      }
    }
    return Object.keys(this.completed).length;
  };
  return { Parser: Parser, Column: Column };
});
const column = new module.exports.Column(0);
column.states.push({ done: true, data: 1, name: "a", n: 2 }, { done: false, data: 2, name: "a", n: 3 }, { done: true, data: module.exports.Parser.fail, name: "b", n: 4 });
for (let turn = 0; turn < 3; turn++) console.log(column.process(), column.states[1].n, column.completed.a.length, "b" in column.completed);
const handler = { get(target, key) { return key in target ? target[key] : "none"; } };
const proxy = new Proxy({ a: 1, b: 2 }, handler);
function read(keys) { let text = ""; for (const key of keys) text += proxy[key] + proxy.a + ","; return text; }
console.log(read(["a", "b", "c"]));
