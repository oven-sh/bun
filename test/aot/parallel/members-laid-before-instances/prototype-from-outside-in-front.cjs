// The prototype of one constructor comes from outside, and a store on it enters a setter there: it constructs another before that one's literal is laid.
const log = [];
const outside = { set keep(make) { const made = make(); log.push(typeof made.twice, made.x); } };
function world(prototype) {
  function First() { }
  function Made(x) { this.x = x; }
  First.prototype = prototype;
  First.prototype.keep = function () { return new Made(5); };
  Made.prototype = { twice: function () { return this.x * 2; } };
  return Made;
}
const Made = world(outside);
for (let i = 0; i < 3; i++) log.push(new Made(i).twice());
console.log(log.join());
