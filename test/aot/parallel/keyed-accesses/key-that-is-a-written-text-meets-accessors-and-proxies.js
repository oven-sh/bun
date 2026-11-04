// objects are read, stored into, asked and deleted from under a variable that holds a written text: plain ones, ones with accessors, below another object, frozen, a Proxy, undefined
let log = [];
class Node { constructor(kind) { this.kind = kind; } }
class Lazy { get kind() { log.push("get"); return "lazy"; } set kind(v) { log.push("set " + v); } }
function read(o) { const k = "kind"; return o[k]; }
function store(o, v) { const k = "kind"; o[k] = v; return o.kind; }
function has(o) { const k = "kind"; return k in o; }
function remove(o) { const k = "kind"; return delete o[k]; }
function define(v) { const k = "kind"; return { a: 1, [k]: v, b: 2 }; }
function tell(f) { try { return String(f()); } catch (e) { return e.name; } }
const proxy = new Proxy({}, {
  get(t, key) { log.push("trap get " + String(key)); return "proxied"; },
  set(t, key, v) { log.push("trap set " + String(key)); return true; },
  has(t, key) { log.push("trap has " + String(key)); return false; },
  deleteProperty(t, key) { log.push("trap delete " + String(key)); return true; },
});
function subjects() { return [new Node("n"), new Lazy(), Object.create(new Node("above")), Object.freeze({ kind: "frozen" }), proxy, { other: 1 }, "text", 5, undefined, null]; }
for (let turn = 0; turn < 3; turn++) {
  const list = subjects();
  for (let i = 0; i < list.length; i++)
    console.log(i, tell(() => read(list[i])), tell(() => store(list[i], "new")), tell(() => has(list[i])), tell(() => remove(list[i])), tell(() => read(list[i])));
  console.log(Object.keys(define(turn)).join(), log.join("; "));
  log = [];
}
