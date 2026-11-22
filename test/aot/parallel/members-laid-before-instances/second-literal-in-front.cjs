// The second literal of one constructor, and one laid behind a read of its prototype, have setters that construct another before that one's literal is laid.
const log = [];
for (const second of [true, false]) {
  const Made = (function () {
    function First() { }
    function Made(x) { this.x = x; }
    if (second) First.prototype = { a: 1 };
    return Made;
  })();
  log.push(typeof new Made(1).twice);
}
const Twice = (function () {
  function First() { }
  function Twice(x) { this.x = x; }
  First.prototype = { a: 1 };
  First.prototype = { set keep(make) { const made = make(); log.push(typeof made.twice, made.x); } };
  First.prototype.keep = function () { return new Twice(6); };
  Twice.prototype = { twice: function () { return this.x * 2; } };
  return Twice;
})();
const Read = (function () {
  function First() { }
  function Read(x) { this.x = x; }
  var before = First.prototype;
  First.prototype = { set keep(make) { const made = make(); log.push(typeof made.twice, before === First.prototype); } };
  First.prototype.keep = function () { return new Read(7); };
  Read.prototype = { twice: function () { return this.x * 2; } };
  return Read;
})();
for (let i = 0; i < 3; i++) log.push(new Twice(i).twice(), new Read(i).twice());
console.log(log.join());
