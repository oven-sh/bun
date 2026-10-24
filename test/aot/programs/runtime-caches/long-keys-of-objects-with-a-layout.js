// A key of thousands of characters that is still a rope names an extra property of an object with a layout, or nothing, like any other key.
const piece = "0123456789abcdef".repeat(200);
function longKey(tail) { return piece + ":" + piece + ":" + tail; }

class Pool { constructor() { this.size = 0; this.label = "pool"; } }
function holders() {
  return [{ __proto__: null }, { size: 0, label: "literal" }, new Pool(), Object.create({ size: 1, label: "inherits" })];
}

for (const holder of holders()) {
  const report = [];
  report.push(holder[longKey("a")], longKey("a") in holder, Object.hasOwn(holder, longKey("a")), delete holder[longKey("a")]);
  holder[longKey("a")] = 1;
  holder[longKey("b")] = 2;
  report.push(holder[longKey("a")], holder[longKey("b")], holder[longKey("c")], longKey("b") in holder, longKey("c") in holder);
  holder[longKey("a")] += 10;
  report.push(holder[longKey("a")], Object.keys(holder).filter(key => key.length > 100).map(key => key.length + key.slice(-1)).join());
  report.push(delete holder[longKey("a")], holder[longKey("a")], Object.hasOwn(holder, longKey("a")), Object.hasOwn(holder, longKey("b")), holder.label);
  console.log(report.join(" "));
}

const base = { size: 2 };
base[longKey("inherited")] = "from the prototype";
const heir = { __proto__: base, own: 1 };
console.log(heir[longKey("inherited")], longKey("inherited") in heir, Object.hasOwn(heir, longKey("inherited")), delete heir[longKey("inherited")], heir[longKey("inherited")]);

const frozen = Object.freeze({ size: 3 });
try { "use strict"; frozen[longKey("a")] = 1; } catch (error) { console.log(error.constructor.name); }
console.log(frozen[longKey("a")], delete frozen[longKey("a")]);
