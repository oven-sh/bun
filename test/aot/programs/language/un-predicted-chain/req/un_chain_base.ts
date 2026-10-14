function Base(this: any) { this._events = Object.create(null); this.count = 0; }
const BasePrototype: any = (Base.prototype = {} as any);
BasePrototype.constructor = Base;
BasePrototype.emit = function emit(this: any, type: any, a: any) { const h = this._events[type]; if (h === undefined) return false; h.call(this, a); return true; };
BasePrototype.addListener = function addListener(this: any, type: any, fn: any) { add(this, type, fn); return this; };
BasePrototype.on = BasePrototype.addListener;
BasePrototype.name = function name() { return "base"; };
function add(target: any, type: any, fn: any) { var events = target._events; if (!events) events = target._events = Object.create(null); events[type] = fn; target.count++; }
export default Base as any;
