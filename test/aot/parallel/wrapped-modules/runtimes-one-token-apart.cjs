// Functions written as the runtimes of webpack and browserify are, but for a declaration that disposes, a parameter's default, or a variable that is read in its dead zone.
const attempt = (run) => { try { return run(); } catch (e) { return e.name; } };
(() => {
  var mods = { 1: (m, exports, req) => { exports.n = 1; } }, cache = {};
  function req(id) { using cached = cache[id]; if (cached !== undefined) return cached.exports; var module = cache[id] = { exports: {} }; mods[id](module, module.exports, req); return module.exports; }
  console.log(req(1).n, attempt(() => req(1).n));
})();
(() => {
  var mods = { 1: (m, exports, req) => { exports.n = 2; } }, cache = {};
  function req(id) { var cached = cache[id]; if (cached !== undefined) return cached.exports; using module = cache[id] = { exports: {} }; mods[id](module, module.exports, req); return module.exports; }
  console.log(attempt(() => req(1).n), attempt(() => req(1).n));
})();
(() => {
  var mods = { 1: (m, exports, req) => { exports.n = 3; } }, cache = {};
  function req(id) { var cached = cache[id]; if (cached !== undefined) return cached.exports; var module = cache[id] = { late: late, exports: {} }; mods[id](module, module.exports, req); return module.exports; }
  console.log(attempt(() => req(1).n)); let late = 3; console.log(req(1).n, late);
})();
(() => {
  var tag = "t", mods = { 1: (m, exports, req) => { exports.n = 4; } }, cache = {};
  function req(id) { var cached = cache[id]; if (cached !== undefined) return cached.exports; var module = cache[id] = { tag: tag, id: id, exports: {} }; mods[id](module, module.exports, req); return module.exports; }
  console.log(req(1).n, req(1) === req(1), tag);
})();
