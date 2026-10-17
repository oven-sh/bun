class EventEmitter {
  constructor() {
    this._events = {};
  }

  on(type, listener) {
    this._events[type] = this._events[type] || [];
    this._events[type].push(listener);
    return this;
  }

  emit(type, ...args) {
    const handlers = this._events[type];
    if (handlers) {
      handlers.forEach(handler => handler.apply(this, args));
      return true;
    }
    return false;
  }

  removeListener(type, listener) {
    if (this._events[type]) {
      this._events[type] = this._events[type].filter(l => l !== listener);
    }
    return this;
  }
}

module.exports = EventEmitter;
module.exports.EventEmitter = EventEmitter;
