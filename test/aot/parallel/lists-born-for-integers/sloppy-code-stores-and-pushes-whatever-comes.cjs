function tell(deed) { try { console.log(deed()); } catch (error) { console.log(error.constructor.name); } }
function text(list) { let all = String(list.length); for (let i = 0; i < list.length; i++) all += "|" + (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole"); return all; }
const kept = { toString() { return "kept"; } };
const values = [kept, "t", undefined, null, true, 1.5, NaN, -0, 7, 2147483648];
function make(n) { return new Array(n | 0); }
function put(list, place, value) { list[place] = value; return list; }
function pushed(list, value) { list.push(value); return list; }
function copy() { const list = new Array(arguments.length); for (let i = 0; i < list.length; i++) list[i] = arguments[i]; return list; }
class Heir extends Array {}
for (let v = 0; v < values.length; v++) {
  const value = values[v];
  tell(() => text(put(make(5), 3, value)));
  tell(() => text(put(make(5), 5, value)));
  tell(() => text(put(make(5), 40, value)));
  tell(() => text(put(Object.freeze(make(3)), 1, value)));
  tell(() => text(put(Object.seal(make(3)), 1, value)));
  tell(() => text(put(Object.preventExtensions(make(3)), 1, value)));
  tell(() => { const list = make(3); list.name = "n"; put(list, 1, value); return text(list) + " " + list.name; });
  tell(() => { const list = new Heir(3); put(list, 1, value); return text(list) + " " + (list instanceof Heir); });
  tell(() => { const list = make(4); put(list, 0, 1); put(list, 1, 2); put(list, 2, value); return text(list); });
  tell(() => { const list = make(3); Object.defineProperty(list, 1, { get() { return "got"; }, set(given) { list.seen = String(given); }, configurable: true }); put(list, 1, value); return text(list) + " " + list.seen; });
  tell(() => { const list = make(3); Object.defineProperty(list, 1, { value: "fixed", writable: false }); put(list, 1, value); return text(list); });
  tell(() => text(copy(value, 1, "t", value)));
  tell(() => text(pushed(make(0), value)));
  tell(() => text(pushed(pushed(pushed(make(0), 1), 2), value)));
  tell(() => text(pushed(make(3), value)));
  tell(() => text(pushed(Object.freeze(make(2)), value)));
  tell(() => { const list = make(0); for (let k = 0; k < 40; k++) pushed(list, k === 20 ? value : k); return text(list); });
}
console.log("end");
