// an emitter as everybody writes it.
let heard = 0; const first = x => { heard = (heard + x) | 0; }, second = x => { heard = (heard ^ x) | 0; }, both = [first, second], names = JSON.parse('["data","end"]');
class Emitter {
  constructor() { this.listeners = {}; }
  on(name, f) { (this.listeners[name] ||= []).push(f); return this; }
  emit(name, ...args) { const list = this.listeners[name]; if (!list) return false; for (const f of list) f(...args); return true; }
  emitOne(name, x) { const list = this.listeners[name]; if (list) for (let i = 0; i < list.length; i++) list[i](x); }
}
const emitter = new Emitter().on("data", first).on("data", second);
function callBoth(x) { for (let i = 0; i < both.length; i++) both[i](x); return heard & 7; }
export const loops = {
  "two functions out of a list": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (callBoth(i))) | 0; return s; },
  "two listeners, one argument": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((emitter.emitOne(names[0], i), heard & 7))) | 0; return s; },
  "two listeners, the rest of the arguments": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((emitter.emit(names[0], i), heard & 7))) | 0; return s; },
  "nobody listens": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((emitter.emit(names[1], i) ? 1 : 2))) | 0; return s; },
};
