// Vue 2's proxy(): accessors made by one function for two written source keys, read and stored in loops. The receiver is what the accessor was laid on, or is not.
// STATISTIC: AccessesDispatchedByKeyString >= 4
const show = (v) => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const lines = [];
const attempt = (f) => { try { return show(f()); } catch (e) { return e.constructor.name; } };
const tell = (...fs) => lines.push(fs.map(attempt).join(" "));
const noop = () => {};
const shared = { enumerable: true, configurable: true, get: noop, set: noop };
function proxy(target, sourceKey, key) {
  shared.get = function proxyGetter() { return this[sourceKey][key]; };
  shared.set = function proxySetter(val) { this[sourceKey][key] = val; };
  Object.defineProperty(target, key, shared);
}
class Component {
  constructor(options) {
    const data = this._data = options.data();
    const keys = Object.keys(data);
    let i = keys.length;
    while (i--) proxy(this, "_data", keys[i]);
    this._props = options.props;
    for (const key of Object.keys(options.props)) proxy(this, "_props", key);
  }
}
const vm = new Component({ data() { return { count: 0, total: 1 }; }, props: { size: 3, label: "x" } });
function counts(turns) { let n = 0; for (let k = 0; k < turns; k++) { vm.count = k & 7; n += vm.count + vm.total; } return n; }
function sizes(turns) { let n = 0; for (let k = 0; k < turns; k++) { vm.size = k; n += vm.size + vm.label.length; } return n; }
function both(turns) { let n = 0; for (let k = 0; k < turns; k++) { vm.total = vm.size + k; n += vm.total - vm.count; } return n; }
class Clean { constructor(data, props) { this._data = data; for (const key of Object.keys(data)) proxy(this, "_data", key); this._props = props; for (const key of Object.keys(props)) proxy(this, "_props", key); } }
const clean = new Clean({ width: 1, height: 2 }, { depth: 3 });
function cleans(turns) { let n = 0; for (let k = 0; k < turns; k++) { clean.width = k & 7; clean.depth = k & 3; n += clean.width + clean.height + clean.depth; } return n; }
const all = () => tell(() => counts(0), () => counts(1), () => counts(80), () => sizes(1), () => sizes(40), () => both(40), () => cleans(1), () => cleans(50), () => vm._data, () => vm._props);
const put = (target, key, value) => { target[key] = value; };
all(); all();
put(vm, "_data", { total: 0.5, count: "s" }); all();
put(vm, "_props", { label: "long", size: -0 }); all();
put(vm, "_data", vm._props); all();
put(vm, "_data", new Proxy({ count: 1, total: 2 }, { get: (t, k) => k === "count" ? 5 : t[k] })); all();
put(vm, "_data", null); all();
put(vm, "_data", Object.freeze({ count: 1, total: 2 })); all();
put(vm, "_data", { get count() { return 9; }, set count(x) { lines.push("inner"); }, total: 3 }); tell(() => counts(3), () => both(2));
put(vm, "_data", { count: 1, total: 2 }); put(vm, "_props", undefined); all();
put(vm, "_props", { size: 1 }); all();
Object.defineProperty(vm, "count", { configurable: true, value: 4, writable: true }); all();
Object.setPrototypeOf(vm, { label: "above" }); delete vm.label; all();
const other = Object.create(vm); other._data = { count: 100, total: 200 }; tell(() => other.count, () => other.total, () => { other.total = 7; return other._data; });
console.log(lines.join("\n"));
