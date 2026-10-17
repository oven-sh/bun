function Emitter() {
  this.table = Object.create(null);
  this.count = 0;
  this.limit ??= undefined;
}
const EmitterPrototype = (Emitter.prototype = {});
EmitterPrototype.constructor = Emitter;
EmitterPrototype.emit = function emit(type, a) {
  const handler = this.table[type];
  if (handler === undefined) return false;
  handler(a);
  return true;
};
EmitterPrototype.on = function on(type, fn) {
  this.table[type] = fn;
  this.count++;
  return this;
};
EmitterPrototype.both = function both(type, a) {
  return [this.emit(type, a), this.emit(type, a)].join();
};
export default Emitter;
