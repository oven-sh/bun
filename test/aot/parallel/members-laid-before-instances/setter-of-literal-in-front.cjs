// A store on one prototype enters the setter of its own literal: it constructs another before that one's literal is there.
const log = [];
const Made = (function () {
  function First() { }
  function Made(x) { this.x = x; }
  First.prototype = { set keep(value) { const made = new Made(5); log.push(typeof made.twice, made.x); } };
  First.prototype.keep = function () { return new First(); };
  Made.prototype = { twice: function () { return this.x * 2; } };
  return Made;
})();
for (let i = 0; i < 3; i++) log.push(new Made(i).twice());
console.log(log.join());
