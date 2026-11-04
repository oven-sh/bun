// a key is joined of two parts for one read: it names a value, a getter, nothing, an element of a list, a trap of a Proxy; the parts are texts, numbers, undefined
let log = [];
function handlerOf(handlers, type) { return handlers["on" + type]; }
function numbered(o, n) { return o["item" + n]; }
function elementOf(list, digit) { return list["1" + digit]; }
function fromNumbers(o, a, b) { return o[`${a}${b}`]; }
const handlers = { onopen: "open", get onclose() { log.push("getter"); return "close"; }, onundefined: "none", item1: "first", "item1.5": "between", 12: "twelve" };
const list = Array.from({ length: 12 }, (_, i) => "e" + i);
const proxy = new Proxy({}, { get(t, key) { log.push("trap " + String(key)); return key.length; } });
for (let turn = 0; turn < 400; turn++) {
  const line = [handlerOf(handlers, "open"), handlerOf(handlers, "close"), handlerOf(handlers, "error"), handlerOf(handlers, undefined), handlerOf(proxy, "x"),
    numbered(handlers, 1), numbered(handlers, 1.5), numbered(handlers, -0), elementOf(list, "0"), elementOf(list, "1"), elementOf(list, "9"), elementOf("abcdefghijkl", "1"), fromNumbers(handlers, 1, 2)].join();
  if (turn % 133 === 0)
    console.log(turn, line, log.length);
}
try { handlerOf(null, "open"); } catch (e) { console.log(e.name); }
