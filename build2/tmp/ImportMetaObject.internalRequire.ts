// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ImportMetaObject.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(id) {  var cached = __intrinsic__requireMap.__intrinsic__get(id);
  const last5 = id.substring(id.length - 5);
  if (cached) {
    return cached.exports;
  }

  // TODO: remove this hardcoding
  if (last5 === ".json") {
    var fs = (globalThis[Symbol.for("_fs")] ||= Bun.fs());
    var exports = JSON.parse(fs.readFileSync(id, "utf8"));
    __intrinsic__requireMap.__intrinsic__set(id, __intrinsic__createCommonJSModule(id, exports, true, undefined));
    return exports;
  } else if (last5 === ".node") {
    const module = __intrinsic__createCommonJSModule(id, {}, true, undefined);
    process.dlopen(module, id);
    __intrinsic__requireMap.__intrinsic__set(id, module);
    return module.exports;
  } else if (last5 === ".toml") {
    var fs = (globalThis[Symbol.for("_fs")] ||= Bun.fs());
    var exports = Bun.TOML.parse(fs.readFileSync(id, "utf8"));
    __intrinsic__requireMap.__intrinsic__set(id, __intrinsic__createCommonJSModule(id, exports, true, undefined));
    return exports;
  } else {
    var exports = __intrinsic__requireESM(id);
    const cachedModule = __intrinsic__requireMap.__intrinsic__get(id);
    if (cachedModule) {
      return cachedModule.exports;
    }
    __intrinsic__requireMap.__intrinsic__set(id, __intrinsic__createCommonJSModule(id, exports, true, undefined));
    return exports;
  }
}).$$capture_end$$;
