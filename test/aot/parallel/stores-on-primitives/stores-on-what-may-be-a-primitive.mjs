class Node {
  constructor(value) {
    this.value = value;
    this.next = null;
  }
  read() {
    return this.value;
  }
}
const seen = [];
function link(holder, next) {
  try {
    holder.next = next;
    holder.late_ = next;
    holder["keyed" + (next.value & 1)] = next;
  } catch (error) {
    seen.push(error.constructor.name);
  }
  return next.read() + ":" + typeof holder?.next + ":" + typeof holder?.late_;
}
function show(value) {
  return typeof value === "symbol" ? "symbol" : typeof value === "object" && value ? "object" : String(value);
}
const holders = ["text", "", 4, -0, NaN, true, 10n, Symbol("s"), null, undefined, new Node(1), {}, [], Object("boxed"), Object.freeze({ next: 1 }), () => 1];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < holders.length; i++) {
    console.log(round, show(holders[i]).slice(0, 12), link(holders[i], new Node(i)));
  }
}
Object.defineProperty(String.prototype, "hooked", {
  set(node) {
    seen.push("set on " + typeof this + " " + node.read());
  },
  get() {
    return "hook";
  },
  configurable: true,
});
Object.defineProperty(Number.prototype, "fixed", { value: 1, writable: false, configurable: true });
Boolean.prototype.plain = 2;
function store(holder, node) {
  const results = [];
  for (const name of ["hooked", "fixed", "plain", "other"]) {
    try {
      holder[name] = node;
      results.push(name);
    } catch (error) {
      results.push(error.constructor.name);
    }
  }
  try {
    holder.hooked = node;
    holder.fixed = node;
    holder.plain = node;
  } catch (error) {
    results.push(error.constructor.name);
  }
  return results.join() + " " + typeof holder.hooked + " " + typeof holder.fixed + " " + typeof holder.plain;
}
for (const holder of ["text", 4, true, new Node(3), Object(5)]) console.log(store(holder, new Node(7)));
console.log(seen.length, [...new Set(seen)].join(";"));
