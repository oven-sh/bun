// What is laid first may be replaced, removed and hidden later, and a constructor may leave its body before its prototype is laid.
const log = [];
function look(Made) { log.push(typeof new Made(0).twice); }
function world(early) {
  function Made(x) { this.x = x; }
  if (early) look(Made);
  Made.prototype = { twice: function () { return this.x * 2; }, get half() { return this.x / 2; } };
  return Made;
}
for (const early of [false, true]) {
  const Made = world(early);
  const made = new Made(8);
  for (let i = 0; i < 6; i++) {
    if (i === 2) Made.prototype.twice = function () { return 'replaced ' + this.x; };
    if (i === 3) delete Made.prototype.twice;
    if (i === 4) made.twice = () => 'own';
    if (i === 5) Object.defineProperty(Made.prototype, 'half', { get() { return 'other'; } });
    log.push(made.twice ? made.twice() : 'none', made.half);
  }
}
const Alone = (function () {
  var firstOf = function () { return new Alone(3).name; };
  function Alone(x) { this.x = x; }
  log.push(typeof firstOf());
  Alone.prototype = { get name() { return 'alone ' + this.x; } };
  Alone.first = firstOf;
  return Alone;
})();
log.push(Alone.first());
console.log(log.join());
