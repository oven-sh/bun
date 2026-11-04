const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
let late;
function read() { let out = ''; for (let i = 0; i < 200; i++) out = typeof late + ':' + (late === undefined); return out; }
(function () {
  if (process.argv.length < 99) return note();
  late = 5;
})();
console.log(attempt(read));
