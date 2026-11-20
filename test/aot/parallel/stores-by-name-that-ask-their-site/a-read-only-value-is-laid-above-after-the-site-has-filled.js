let store = function (o, v) { "use strict"; o.tag = v; };
if (Date.now() < 0) store = null;
function turns(n, each, done) { let i = 0; const next = () => { if (i === n) return done(); each(i++); queueMicrotask(next); }; next(); }
const out = []; let log = "";
const keys = o => Reflect.ownKeys(o).map(String).join();
function put(o, v) { try { store(o, v); return "ok"; } catch (e) { return e.constructor.name; } }
const above = {};
turns(400, i => {
  const o = Object.create(above); o.id = i;
  if (i === 300) Object.defineProperty(above, "tag", { value: "fixed", writable: false, configurable: true });
  if (i === 350) Object.defineProperty(above, "tag", { value: "free", writable: true, configurable: true });
  const said = put(o, i);
  if (i % 50 === 49 || (i >= 298 && i <= 302) || (i >= 348 && i <= 352)) out.push(i + "|" + said + "|" + keys(o) + "|" + o.tag);
}, () => {
console.log(out.join("\n"));
});
