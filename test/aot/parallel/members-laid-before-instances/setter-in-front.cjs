// A setter on Function.prototype runs while the body lays the prototypes: it constructs one before the literal is there.
const log = [];
Object.defineProperty(Function.prototype, 'watched', { set(value) { const made = new this(value); log.push(typeof made.twice, made.x); }, configurable: true });
const Made = (function () {
  function Made(x) { this.x = x; }
  Made.watched = 4;
  Made.prototype = { twice: function () { return this.x * 2; } };
  return Made;
})();
for (let i = 0; i < 3; i++) log.push(new Made(i).twice());
console.log(log.join());
