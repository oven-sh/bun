const opaque = (v) => (process.argv.length > 99 ? undefined : v);
const say = (v) => { try { return typeof v === "function" ? "a function" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
function read(n) { const o = new F(n); return ("m" in o) + "," + Object.hasOwn(o, "m") + "," + typeof o.m; }
const show = (when) => { let r; try { r = say(read(5)); } catch (e) { r = "threw " + e.name; } console.log(when, r); };
F.prototype.m = first; show("a"); Object.defineProperty(F.prototype, "m", { get() { return other; }, configurable: true }); show("b");
