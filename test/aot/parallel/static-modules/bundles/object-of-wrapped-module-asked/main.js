// The `exports` and `module.exports` of a wrapped module are objects, also where nothing but that is asked of them.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

var require_name = __commonJS((exports) => {
  exports.a = 1;
  exports.log = [!exports, exports == null, exports === undefined, exports != null, exports ? "object" : "nothing", typeof (exports && 5)].join();
  if (exports) exports.b = 2;
  exports && (exports.c = 3);
});

var require_module = __commonJS((exports, module) => {
  exports.a = 1;
  exports.log = [!module.exports, module.exports == null, module.exports === undefined, module.exports != null, module.exports ? "object" : "nothing", typeof (module.exports && 5)].join();
  if (module.exports) exports.b = 2;
  module.exports && (exports.c = 3);
});

var require_kind = __commonJS((exports) => {
  exports.kind = exports ? "object" : "nothing";
});

var require_holder = __commonJS((exports, module) => {
  exports.a = 1;
  exports.log = [!module, module == null, module === undefined, module != null, module ? "object" : "nothing", typeof (module && 5), typeof module].join();
  if (module) exports.b = 2;
  module && (exports.c = 3);
});

const byName = require_name(), byModule = require_module(), byHolder = require_holder();
console.log(byName.a, byName.log, byName.b, byName.c);
console.log(byModule.a, byModule.log, byModule.b, byModule.c);
console.log(byHolder.a, byHolder.log, byHolder.b, byHolder.c);
console.log(require_kind().kind);
