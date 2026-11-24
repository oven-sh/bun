// Names that no class lists, read together in loops off instances that were given them by key, by Object.assign and by definition.
class Assigned { constructor(o) { Object.assign(this, o); } five() { return 5; } }
class Filled { constructor(o) { this.id = 7; for (var k in o) this[k] = o[k]; } }
class Defined { constructor(o) { this.id = 8; for (var k in o) Object.defineProperty(this, k, { value: o[k], writable: true, enumerable: true, configurable: true }); } }
class Below extends Assigned { constructor(o) { super(o); this.last = 1; } }
var assigned = [], filled = [], defined = [], below = [];
for (var i = 0; i < 16; i++) { assigned.push(new Assigned(JSON.parse('{"ax":' + i + ',"by":1,"cz":2}'))); filled.push(new Filled(JSON.parse('{"ax":' + i + ',"by":1.5,"cz":3}'))); defined.push(new Defined(JSON.parse('{"ax":' + i + ',"by":1,"cz":2}'))); below.push(new Below(JSON.parse('{"cz":2,"ax":' + i + ',"by":1}'))); }
function readAssigned(k) { var s = 0; for (var i = 0; i < k; i++) { var o = assigned[i & 15]; s = (s + o.ax + o.by) | 0; } return s; }
function readFilled(k) { var s = 0; for (var i = 0; i < k; i++) { var o = filled[i & 15]; s += o.ax + o.by + o.cz; } return s; }
function readDefined(k) { var s = 0; for (var i = 0; i < k; i++) { var o = defined[i & 15]; s = (s + o.ax + o.by) | 0; } return s; }
function readBelow(k) { var s = 0; for (var i = 0; i < k; i++) { var o = below[i & 15]; s = (s + o.ax + o.by + o.cz) | 0; } return s; }
function all(k) { console.log(readAssigned(k), readFilled(k), readDefined(k), readBelow(k)); }
all(10); all(300); all(300);
assigned[3].ax = "x"; filled[4].cz = 0.25; delete defined[5].by; Object.defineProperty(below[6], "ax", { get: function () { return 70; } });
all(10); all(300);
assigned[3].ax = 3; below[7] = new Assigned({}); filled.push(JSON.parse('{"ax":1,"by":2,"cz":3}')); Object.freeze(assigned[2]); Bun.gc(true);
all(10); all(300);
function read(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s += o.ax + o.by + o.cz; } return s; }
function some(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s = (s + o.ax + o.by) | 0; if (o.cz > 4) s = (s + o.nowhere) | 0; } return s; }
function text(all, k) { var s = ""; for (var i = 0; i < k; i++) { var o = all[i & 15]; s += o.ax + "" + o.by; } return s.slice(-50); }
var makers = {
  Assigned: function (i) { return new Assigned(JSON.parse('{"ax":' + i + ',"by":1,"cz":2}')); },
  Filled: function (i) { return new Filled(JSON.parse('{"ax":' + i + ',"by":1.5,"cz":' + (i & 7) + "}")); },
  Defined: function (i) { return new Defined(JSON.parse('{"ax":' + i + ',"by":1,"cz":2}')); },
  Below: function (i) { return new Below(JSON.parse('{"cz":2,"ax":' + i + ',"by":1}')); },
  many: function (i) { return new Assigned(JSON.parse('{"a1":1,"a2":2,"a3":3,"a4":4,"a5":5,"a6":6,"a7":7,"ax":' + i + ',"a8":8,"by":1,"a9":9,"cz":2}')); },
  orders: function (i) { return new Assigned(JSON.parse(i & 1 ? '{"ax":' + i + ',"by":1,"cz":2}' : '{"cz":2,"by":1,"ax":' + i + "}")); },
  kinds: function (i) { return i % 3 ? i % 2 ? new Assigned({ ["a" + "x"]: i, ["b" + "y"]: 1, ["c" + "z"]: 2 }) : JSON.parse('{"ax":' + i + ',"by":1,"cz":2}') : new Filled(JSON.parse('{"ax":' + i + ',"by":1,"cz":2}')); },
};
var changes = {
  none: function () {}, value: function (all) { all[3].ax = "text"; all[5].by = 0.125; }, taken: function (all) { delete all[2].ax; delete all[4].by; },
  more: function (all) { all[1].extra = 1; for (var i = 0; i < 40; i++) all[6]["n" + i] = i; }, getter: function (all) { Object.defineProperty(all[3], "ax", { get: function () { return 40; }, configurable: true }); },
  above: function (all) { Object.setPrototypeOf(all[2], { ax: 50, by: 60 }); delete all[2].ax; }, frozen: function (all) { Object.freeze(all[1]); }, collected: function () { Bun.gc(true); },
  proxy: function (all) { all[4] = new Proxy(all[4], {}); }, primitives: function (all) { all[7] = 5; all[8] = "abc"; }, nullish: function (all) { all[9] = null; },
};
for (var name in makers) {
  for (var change in changes) {
    var all = [], out = []; for (var i = 0; i < 16; i++) all.push(makers[name](i));
    for (var f of [read, some, text]) { for (var k of [10, 60, 200]) { try { out.push(f(all, k)); } catch (e) { out.push(e.name); } } }
    changes[change](all);
    for (var f of [read, some, text]) { for (var k of [10, 60, 200]) { try { out.push(f(all, k)); } catch (e) { out.push(e.name); } } }
    console.log(name, change, out.join());
  }
}
