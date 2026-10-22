module.exports = Emitter;
function Emitter() {
  this.listeners = {};
}
Emitter.defaultMax = 10;
Emitter.prototype.on = function (name, listener) {
  (this.listeners[name] ||= []).push(listener);
  return this;
};
Emitter.prototype.emit = function (name, value) {
  const listeners = this.listeners[name] || [];
  for (const listener of listeners) listener(value);
  return listeners.length;
};
module.exports.Emitter = Emitter;
