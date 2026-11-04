var Parser = (function () {
  function Parser(text) { this.text = text; this.at = 0; }
  Parser.prototype.peek = function () { return this.text.charCodeAt(this.at); };
  Parser.prototype.next = function () { var c = this.peek(); this.at++; return c; };
  Parser.prototype.done = function () { return this.at >= this.text.length; };
  return Parser;
})();
function run(count) { var total = 0; for (var i = 0; i < count; i++) { var p = new Parser("abc"); while (!p.done()) total += p.next(); } return total; }
console.log(run(3), Object.keys(new Parser("x")).join(), new Parser("x") instanceof Parser);
