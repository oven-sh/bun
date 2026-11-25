// STATISTIC: PrototypesLaidByHelpers >= 3
// Direct evals that never run see the names of the file. The helper links the classes all the same.
var __extends = this.__extends || function (d, b) {
  function __() { this.constructor = d; }
  __.prototype = b.prototype;
  d.prototype = new __();
};
var host = { run: function (source) { try { eval(source); } catch (e) { throw e; } } };
var NS;
(function (NS) {
  var Span = (function () { function Span() { this.min = -1; this.max = -1; } return Span; })();
  NS.Span = Span;
  var Node = (function (_super) {
    __extends(Node, _super);
    function Node(kind) { _super.call(this); this.kind = kind; this.flags = NS.Flag; }
    Node.prototype.isName = function () { return false; };
    Node.prototype.value = function () { return this.kind; };
    return Node;
  })(Span);
  NS.Node = Node;
  var Name = (function (_super) {
    __extends(Name, _super);
    function Name(text) { _super.call(this, 20); this.text = text; }
    Name.prototype.isName = function () { return true; };
    return Name;
  })(Node);
  NS.Name = Name;
  var Pair = (function (_super) {
    __extends(Pair, _super);
    function Pair(kind, a, b) { _super.call(this, kind); this.a = a; this.b = b; }
    Pair.prototype.value = function () { return this.a.value() + this.b.value() + this.min; };
    return Pair;
  })(Node);
  NS.Pair = Pair;
  NS.Flag = 7;
})(NS || (NS = {}));
function build(n) {
  var node = new NS.Name('a');
  for (var i = 0; i < n; i++) node = new NS.Pair(i & 7, new NS.Name('b' + i), node);
  var s = 0;
  for (var at = node; at.b; at = at.b) s += at.kind + at.a.kind + at.flags + (at.a.isName() ? 1 : 0) + (at.isName() ? 100 : 0);
  return s + node.value();
}
console.log(build(10), build(3), new NS.Pair(1, 2, 3) instanceof NS.Span);
