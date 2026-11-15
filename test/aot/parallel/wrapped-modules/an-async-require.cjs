// A function written as webpack's require is, but async: a call answers with a promise.
(() => {
  var mods = { 1: (m, exports, req) => { exports.f = (x) => "f" + x; exports.n = 5; }, 2: (m, exports, req) => { exports.sum = async (x) => (await req(1)).n + x; } };
  var cache = {}; async function load(id) { var cached = cache[id]; if (cached !== undefined) return cached.exports; var module = cache[id] = { exports: {} }; mods[id](module, module.exports, load); return module.exports; }
  console.log(load(1).n, typeof load(1).f);
  try { console.log(load(1).f(3)); } catch (e) { console.log(e.name); }
  load(1).then(m => console.log(m.n));
  load(2).then(m => m.sum(2)).then(sum => console.log(sum));
})();
