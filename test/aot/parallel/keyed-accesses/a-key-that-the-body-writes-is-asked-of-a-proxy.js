// `let k ="kind"; node[k]` is built as `node.kind`. A proxy is told the same name, once, as a string, for the read, the store and `in`.
// Under: --aot-testing=CheckProofsAtRunTime: the field that an access under a written key goes to
class Item { constructor(kind) { this.kind = kind; } }
function kindOf(node) { let k ="kind"; return node[k]; }
function setKind(node, value) { let k ="kind"; node[k] = value; }
function hasKind(node) { let k ="kind"; return k in node; }
const lines = [];
const told = [];
const proxy = new Proxy(new Item("target"), {
  get(target, name, receiver) { told.push("get " + typeof name + " " + String(name) + " " + (receiver === proxy)); return Reflect.get(target, name, receiver); },
  set(target, name, value, receiver) { told.push("set " + typeof name + " " + String(name) + " " + value); return Reflect.set(target, name, value, receiver); },
  has(target, name) { told.push("has " + typeof name + " " + String(name)); return Reflect.has(target, name); },
});
for (const node of [new Item("plain"), proxy, new Item("plain again"), Object.create(proxy)]) {
  lines.push(kindOf(node), hasKind(node));
  setKind(node, "stored");
  lines.push(kindOf(node));
}
console.log(lines.join("\n"));
console.log(told.join("\n"));
