// A function of a literal under a name in lower case, which stores into `this`: a method, or a constructor all the same.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
const kinds = { point: function (x, y) { this.x = x; this.y = y; }, Line: function (p, q) { this.p = p; this.q = q; } };
kinds.point.prototype.sum = function () { return this.x + this.y; };
tell("constructed by name", () => { const p = new kinds.point(1, 2), l = new kinds.Line(p, new kinds.point(3, 4)); return [p.sum(), l.q.sum(), p instanceof kinds.point, Object.keys(l)]; });
const methods = { fill: function (v) { this.v = v; return this; }, get: function () { return this.v; } };
tell("constructed by a variable", () => { const name = process.argv[2] || "fill"; const o = new methods[name](5); return [o.v, o instanceof methods.fill, Object.keys(o)]; });
tell("called on others", () => [methods.fill.call({}, 6).v, methods.fill.call([1], 7).v, (() => { try { return methods.fill.call(undefined, 8).v; } catch (e) { return e.constructor.name; } })()]);
tell("on the literal", () => [methods.fill(9).get(), methods.v, Object.keys(methods)]);
const mixed = { count: 0, _step: function () { this.count++; return this; }, $reset: function () { this.count = 0; return this; } };
tell("state", () => [mixed._step()._step().count, mixed.$reset().count]);
for (const line of out) console.log(line);
