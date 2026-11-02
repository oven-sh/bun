// A function, or the text of an eval, assigns another factory to the variable between two calls, so the second call enters the other one.
var log = [];
var wrap = run => () => "first " + run();
var keep = () => wrap;
var a = wrap(() => 1);
function replace() {
  wrap = run => () => "second " + run();
}
replace();
var b = wrap(() => 2);
log.push(a(), b(), keep()(() => 3)());

var hold = run => () => "held " + run();
var look = () => hold;
var c = hold(() => 4);
(function () {
  eval('hold = run => () => "evaluated " + run()');
})();
var d = hold(() => 5);
log.push(c(), d(), look()(() => 6)());

(function () {
  var make = run => () => "inner " + run();
  var see = () => make;
  var e = make(() => 7);
  var f = make(() => "eight");
  log.push(e(), f(), see() === make);
})();

module.exports = log;
console.log(log.join(" | "));
