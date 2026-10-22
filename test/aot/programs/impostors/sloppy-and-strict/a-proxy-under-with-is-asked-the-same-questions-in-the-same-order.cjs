// What a proxy under `with` is asked, in order, by a store, a read, a compound assignment, an increment, typeof, delete, a call, a pattern and a store to a name that has vanished.
var log = [];
function watch(target) {
  return new Proxy(target, {
    has(t, key) { log.push("has " + String(key)); return Reflect.has(t, key); },
    get(t, key, r) { log.push("get " + String(key)); return Reflect.get(t, key, r); },
    set(t, key, v, r) { log.push("set " + String(key)); return Reflect.set(t, key, v, r); },
    deleteProperty(t, key) { log.push("delete " + String(key)); return Reflect.deleteProperty(t, key); },
    getOwnPropertyDescriptor(t, key) { log.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(t, key); },
    defineProperty(t, key, d) { log.push("define " + String(key)); return Reflect.defineProperty(t, key, d); },
  });
}
function report(title, run) {
  var answer;
  try { answer = run(); } catch (e) { answer = e.constructor.name; }
  console.log(title + ": " + log.splice(0).join(", ") + " -> " + String(answer));
}
var outside = "outside";
report("store", function () { with (watch({ x: 5 })) { x = "stored"; return x; } });
report("store of a name it lacks", function () { with (watch({ x: 5 })) { outside = "changed"; return outside; } });
report("read", function () { with (watch({ x: 5 })) { return x; } });
report("add", function () { with (watch({ x: 5 })) { x += 1; return x; } });
report("increment", function () { with (watch({ x: 5 })) { return x++; } });
report("typeof", function () { with (watch({ x: 5 })) { return typeof x; } });
report("delete", function () { with (watch({ x: 5 })) { return delete x; } });
report("call", function () { with (watch({ x: function () { return this === undefined ? "no receiver" : typeof this; } })) { return x(); } });
report("logical", function () { with (watch({ x: null })) { x ??= 3; return x; } });
report("pattern", function () { with (watch({ x: 5, y: 6 })) { [x, y] = [1, 2]; return x + y; } });
report("vanishes", function () { var o = { x: 5 }; with (watch(o)) { x = (delete o.x, "late"); } return o.x + " " + typeof globalThis.x; });
report("nested", function () { with (watch({ x: 1 })) { with (watch({ y: 2 })) { x = y; return x; } } });
