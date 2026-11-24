// A function written as webpack's require is, but a generator: a call answers with a generator, whose body has not run.
(() => {
  var mods = { 1: (m, exports, req) => { exports.n = 7; console.log("body"); } };
  var cache = {}; function* load(id) { var cached = cache[id]; if (cached !== undefined) return cached.exports; var module = cache[id] = { exports: {} }; mods[id](module, module.exports, load); return module.exports; }
  console.log(load(1).n);
  console.log(load(1).n === undefined);
})();
