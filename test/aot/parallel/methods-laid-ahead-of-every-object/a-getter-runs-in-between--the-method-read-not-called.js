const opaque = (v) => (process.argv.length > 99 ? undefined : v);
const say = (v) => { try { return typeof v === "function" ? "a function" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
function read(n) { const o = new F(n); const m = o.m; return say(m) + (m === first) + (m === other); }
const show = (when) => { let r; try { r = say(read(5)); } catch (e) { r = "threw " + e.name; } console.log(when, r); };
const probe = { get now() { show("in the getter"); return 1; } }; opaque(probe).now; F.prototype.m = first; show("behind");
