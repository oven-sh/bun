// A body of a bundle that calls `module.exports` passes it the module's object as `this`.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_own = __commonJS((exports, module) => { module.exports = function (x) { return (this && typeof this.exports) + " " + x; }; module.exports.called = module.exports(1); module.exports.optional = module.exports?.(2); module.exports.keyed = module["exports"](3); });
console.log(require_own().called, require_own().optional, require_own().keyed);
var require_tag = __commonJS((exports, module) => { module.exports = (strings, value) => strings.join("_") + value; module.exports.tagged = module.exports`a${1}b`; });
console.log(require_tag().tagged, require_tag()(["x", "y"], 2));
var require_maker = __commonJS((exports, module) => {
  module.exports = function Maker(x) { if (!(this instanceof Maker)) return new Maker(x); this.x = x; };
  module.exports.make = x => module.exports(x);
  module.exports.prototype.read = function () { return this.x; };
});
console.log(require_maker().make(3).read(), require_maker()(4).read(), new (require_maker())(5).read());
var require_plain = __commonJS((exports, module) => { exports.x = 1; try { module.exports(1); } catch (error) { console.log(error.name); } });
console.log(require_plain().x);
(() => {
  var mods = {
    1: function (module, exports, req) { module.exports = function (x) { return (this === module) + " " + x; }; module.exports.self = module.exports(6); },
    2: module => { module.exports = x => x * 2; module.exports.y = module.exports(7); },
  };
  var cache = {};
  function req(id) { var cached = cache[id]; if (cached !== undefined) return cached.exports; var module = cache[id] = { exports: {} }; mods[id](module, module.exports, req); return module.exports; }
  console.log(req(1).self, req(2).y, req(2)(8));
})();
