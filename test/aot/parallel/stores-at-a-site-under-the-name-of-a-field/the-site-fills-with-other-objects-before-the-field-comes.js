let store = function (o, v) { "use strict"; o.tag = v; };
if (Date.now() < 0) store = null;
function turns(n, each, done) { let i = 0; const next = () => { if (i === n) return done(); each(i++); queueMicrotask(next); }; next(); }
const out = [];
const keys = o => Reflect.ownKeys(o).map(String).join();
function put(o, v) { try { store(o, v); return "ok"; } catch (e) { return e.constructor.name; } }
class Tagged { constructor(id) { this.id = id; this.tag = "born"; } }
const above = {};
turns(700, i => {
  const o = i < 400 ? Object.create(above) : i % 2 ? new Tagged(i) : Object.create(above);
  const said = put(o, i);
  if (i % 100 === 99 || (i >= 398 && i <= 404)) out.push(i + "|" + said + "|" + keys(o) + "|" + o.tag);
}, () => {
console.log(out.join("\n"));
});
