function EventEmitter(opts) {
  if (this._events === undefined || this._events === this.__proto__._events) {
    this._events = Object.create(null);
    this._eventsCount = 0;
  }
  this._maxListeners ??= undefined;
}
const EventEmitterPrototype = (EventEmitter.prototype = {});
EventEmitterPrototype.constructor = EventEmitter;
EventEmitterPrototype.emit = function emit(type, ...args) {
  if (type === "error") return false;
  var { _events: events } = this;
  if (events === undefined) return false;
  var handler = events[type];
  if (handler === undefined) return false;
  if (typeof handler === "function") {
    switch (args.length) {
      case 0: handler.call(this); break;
      case 1: handler.call(this, args[0]); break;
      case 2: handler.call(this, args[0], args[1]); break;
      case 3: handler.call(this, args[0], args[1], args[2]); break;
      default: handler.apply(this, args); break;
    }
    return true;
  }
  for (let i = 0, { length } = handler; i < length; i++) {
    const listener = handler[i];
    switch (args.length) {
      case 0: listener.call(this); break;
      case 1: listener.call(this, args[0]); break;
      default: listener.apply(this, args); break;
    }
  }
  return true;
};
EventEmitterPrototype.on = function on(type, fn) {
  var events = this._events; var existing = events[type];
  if (existing === undefined) { events[type] = fn; this._eventsCount++; return this; }
  events[type] = typeof existing === "function" ? [existing, fn] : [...existing, fn];
  return this;
};
export default EventEmitter;
