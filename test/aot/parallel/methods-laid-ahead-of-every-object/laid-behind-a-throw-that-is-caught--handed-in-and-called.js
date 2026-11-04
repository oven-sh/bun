const opaque = (v) => (process.argv.length > 99 ? undefined : v);
const say = (v) => { try { return typeof v === "function" ? "a function" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
function callIt(o) { return o.m(); }
function read(n) { let t = 0; for (let i = 0; i < n; i++) t += callIt(made(i & 7)); return t; }
function made(x) { return new F(x); }
const show = (when) => { let r; try { r = say(read(5)); } catch (e) { r = "threw " + e.name; } console.log(when, r); };
try { if (opaque(true)) throw new Error("stop"); F.prototype.m = first; } catch (e) { } show("a");
