let store = function (o, v) { "use strict"; o.tag = v; };
if (Date.now() < 0) store = null;
function turns(n, each, done) { let i = 0; const next = () => { if (i === n) return done(); each(i++); queueMicrotask(next); }; next(); }
const out = [];
const keys = o => Reflect.ownKeys(o).map(String).join();
function put(o, v) { try { store(o, v); return "ok"; } catch (e) { return e.constructor.name; } }
class Tagged { constructor(id) { this.id = id; this.tag = "born"; } }
class Watched { constructor(id) { this.id = id; } set tag(v) { this.id = "set " + v; } get tag() { return "got"; } }
class Below extends Watched { }
turns(600, i => {
  const o = i % 4 === 0 ? new Tagged(i) : i % 4 === 1 ? new Watched(i) : i % 4 === 2 ? new Below(i) : Object.create(new Tagged(-i));
  const said = put(o, i);
  if (i >= 588 || i < 8) out.push(i + "|" + said + "|" + keys(o) + "|" + o.tag + "|" + o.id);
}, () => {
console.log(out.join("\n"));
});
