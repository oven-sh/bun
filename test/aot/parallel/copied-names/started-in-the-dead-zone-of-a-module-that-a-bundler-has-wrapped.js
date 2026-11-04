var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_b = __commonJS((exports) => { exports.n = 1; });
var require_a = __commonJS((exports) => {
  function run(f) { return f(); }
  let said;
  try { said = run(a); } catch (e) { said = e.constructor.name; }
  const b = require_b();
  exports.said = said + " " + a();
  function a() { return walk(); }
  function walk() { return b.n; }
});
console.log(require_a().said);
