function outer(run) {
  let said;
  try { said = run(a); } catch (e) { said = e.constructor.name; }
  const path = require("node:path");
  return said + " " + a() + " " + b();
  function a() { return walk(); }
  function b() { return path.join("x", "y"); }
  function walk() { return path.sep.length + path.delimiter.length; }
}
console.log(outer(f => f()));
