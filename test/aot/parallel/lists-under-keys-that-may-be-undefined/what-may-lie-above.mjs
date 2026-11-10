// Who may answer above a list under "undefined", "null", "true", "false": a class below Array, an object laid between, an accessor on the list itself, a proxy. Each writes on the list that it gets as `this`.
const t = f => { try { return String(f()); } catch (e) { return e.name; } }; const q = [];
class L extends Array { get undefined() { this[0] = "seen"; return "L" + this.length; } get null() { return "n"; } } const a = L.of(1, 2); console.log(a[q.shift()], a[0], L.of(3).map(x => x)[q.pop()], a.slice(1)[null]);
const b = [1, 2]; Object.setPrototypeOf(b, { __proto__: Array.prototype, get undefined() { this[1] = "above"; return 5; } }); console.log(b[q.shift()], b[1], b.length);
const c = [1, 2]; Object.defineProperty(c, "undefined", { get() { this.push("own"); return this.length; } }); console.log(c[q.shift()], c.length, c[2]);
const d = [1, 2]; d.__proto__ = { get true() { return "t" + (this === d); } }; console.log(d[d.length === undefined], d[1]); const p = new Proxy([1], { get: (x, k) => "p" + String(k) }); console.log(p[q.shift()], p[0]);
const any = [a, b, [9]]; for (const x of any) console.log(t(() => x[q.shift()]));
