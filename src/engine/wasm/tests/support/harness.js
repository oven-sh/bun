// Assertions and a builder of modules in bytes, for the tests of the WebAssembly API.

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail("not true: " + (message || "a condition"));
}

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function assertEq(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    fail("expected " + show(expected) + " but got " + show(actual) + (message ? " for " + message : ""));
  }
}

function assertDeepEq(actual, expected, message) {
  assertEq(JSON.stringify(actual), JSON.stringify(expected), message);
}

function assertThrows(kind, body, message) {
  var thrown;
  try {
    body();
  } catch (error) {
    if (error instanceof kind) return error;
    thrown = error;
    fail("expected " + kind.name + " but got " + error + (message ? " for " + message : ""));
  }
  fail("expected " + kind.name + " but nothing was thrown" + (message ? " for " + message : ""));
}

// The message is without the text of the expression that failed.
function assertError(error, kind, message) {
  assertEq(Object.getPrototypeOf(error), kind.prototype, String(error));
  assertEq(error.message.replace(/ \(evaluating .*/s, ""), message);
}

function throws(kind, message, body) {
  assertError(assertThrows(kind, body, message), kind, message);
}

async function rejects(kind, message, promise) {
  assert(promise instanceof Promise);
  assertError(
    await promise.then(
      () => fail("expected " + message),
      error => error,
    ),
    kind,
    message,
  );
}

// An object that notes which properties are read.
function logging(log, object) {
  return new Proxy(object, {
    get(target, key) {
      log.push(key);
      return target[key];
    },
  });
}

// What runs once every promise that the script made has settled.
var checks = [];

function later(body) {
  checks.push(body);
}

function runAsync(body) {
  var outcome = new Error("an asynchronous test did not end");
  body().then(
    () => (outcome = undefined),
    error => (outcome = error),
  );
  later(() => {
    if (outcome) throw outcome;
  });
}

function runChecks() {
  for (var index = 0; index < checks.length; index++) checks[index]();
}

// The types of values, as the binary format writes them.
var kI32 = 0x7f,
  kI64 = 0x7e,
  kF32 = 0x7d,
  kF64 = 0x7c,
  kV128 = 0x7b;
var kFuncRef = 0x70,
  kExternRef = 0x6f,
  kExnRef = 0x69,
  kAnyRef = 0x6e,
  kRefFunc = [0x64, 0x70],
  kRefExtern = [0x64, 0x6f];
var kExternFunc = 0,
  kExternTable = 1,
  kExternMemory = 2,
  kExternGlobal = 3,
  kExternTag = 4;

function uleb(value) {
  var out = [];
  do {
    var byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value !== 0) byte |= 0x80;
    out.push(byte);
  } while (value !== 0);
  return out;
}

function sleb(value) {
  var out = [];
  for (;;) {
    var byte = value & 0x7f;
    value = Math.floor(value / 128);
    if ((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

function utf8(text) {
  var out = [];
  for (var index = 0; index < text.length; index++) {
    var code = text.charCodeAt(index);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return out;
}

function encodeName(text) {
  return uleb(utf8(text).length).concat(utf8(text));
}

function vec(items) {
  var out = uleb(items.length);
  for (var index = 0; index < items.length; index++) out = out.concat(items[index]);
  return out;
}

function limits(initial, maximum, isShared) {
  if (maximum === undefined) return [isShared ? 2 : 0].concat(uleb(initial));
  return [isShared ? 3 : 1].concat(uleb(initial), uleb(maximum));
}

// The instructions that give a constant of a type.
function constant(type, value) {
  if (type === kI32) return [0x41].concat(sleb(value), [0x0b]);
  if (type === kI64) return [0x42].concat(sleb(value), [0x0b]);
  if (type === kF32) {
    var bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    return [0x43].concat(Array.from(bytes), [0x0b]);
  }
  if (type === kF64) {
    var wide = new Uint8Array(8);
    new DataView(wide.buffer).setFloat64(0, value, true);
    return [0x44].concat(Array.from(wide), [0x0b]);
  }
  return [0xd0, type, 0x0b];
}

function Builder() {
  this.types = [];
  this.imports = [];
  this.importKinds = [];
  this.funcs = [];
  this.tables = [];
  this.memories = [];
  this.globals = [];
  this.tags = [];
  this.exports = [];
  this.elems = [];
  this.data = [];
  this.start = undefined;
  this.custom = [];
}

Builder.prototype.addType = function (params, results) {
  this.types.push(
    [0x60].concat(
      vec(
        params.map(function (it) {
          return [].concat(it);
        }),
      ),
      vec(
        results.map(function (it) {
          return [].concat(it);
        }),
      ),
    ),
  );
  return this.types.length - 1;
};

Builder.prototype.addImport = function (module, field, description) {
  this.imports.push(encodeName(module).concat(encodeName(field), description));
  this.importKinds.push(description[0]);
  return this;
};

Builder.prototype.importFunction = function (module, field, type) {
  return this.addImport(module, field, [kExternFunc].concat(uleb(type)));
};

Builder.prototype.importMemory = function (module, field, initial, maximum, isShared) {
  return this.addImport(module, field, [kExternMemory].concat(limits(initial, maximum, isShared)));
};

Builder.prototype.importTable = function (module, field, element, initial, maximum) {
  return this.addImport(module, field, [kExternTable, element].concat(limits(initial, maximum)));
};

Builder.prototype.importGlobal = function (module, field, type, isMutable) {
  return this.addImport(module, field, [kExternGlobal].concat(type, isMutable ? 1 : 0));
};

// `body` is the instructions without the `end`.
Builder.prototype.addFunction = function (type, locals, body) {
  this.funcs.push({ type: type, locals: locals || [], body: body });
  return this.importedFunctionCount() + this.funcs.length - 1;
};

Builder.prototype.importedFunctionCount = function () {
  var count = 0;
  for (var index = 0; index < this.importKinds.length; index++) {
    count += this.importKinds[index] === kExternFunc ? 1 : 0;
  }
  return count;
};

Builder.prototype.addMemory = function (initial, maximum, isShared) {
  this.memories.push(limits(initial, maximum, isShared));
  return this;
};

Builder.prototype.addTable = function (element, initial, maximum) {
  this.tables.push([element].concat(limits(initial, maximum)));
  return this;
};

Builder.prototype.addGlobal = function (type, isMutable, value) {
  this.globals.push([type, isMutable ? 1 : 0].concat(constant(type, value)));
  return this.globals.length - 1;
};

Builder.prototype.addTag = function (type) {
  this.tags.push([0].concat(uleb(type)));
  return this.tags.length - 1;
};

Builder.prototype.addExport = function (field, kind, index) {
  this.exports.push(encodeName(field).concat([kind], uleb(index)));
  return this;
};

Builder.prototype.addElements = function (offset, funcs) {
  this.elems.push([0].concat(constant(kI32, offset), vec(funcs.map(uleb))));
  return this;
};

Builder.prototype.addData = function (offset, bytes) {
  this.data.push([0].concat(constant(kI32, offset), uleb(bytes.length), bytes));
  return this;
};

Builder.prototype.toModule = function (options) {
  return new WebAssembly.Module(this.toBytes(), options);
};

Builder.prototype.instantiate = function (imports, options) {
  return new WebAssembly.Instance(this.toModule(options), imports).exports;
};

Builder.prototype.addCustomSection = function (field, bytes) {
  this.custom.push(encodeName(field).concat(bytes));
  return this;
};

function section(id, body) {
  return [id].concat(uleb(body.length), body);
}

Builder.prototype.toBytes = function () {
  var out = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  if (this.types.length) out = out.concat(section(1, vec(this.types)));
  if (this.imports.length) out = out.concat(section(2, vec(this.imports)));
  if (this.funcs.length) {
    out = out.concat(
      section(
        3,
        vec(
          this.funcs.map(function (it) {
            return uleb(it.type);
          }),
        ),
      ),
    );
  }
  if (this.tables.length) out = out.concat(section(4, vec(this.tables)));
  if (this.memories.length) out = out.concat(section(5, vec(this.memories)));
  if (this.tags.length) out = out.concat(section(13, vec(this.tags)));
  if (this.globals.length) out = out.concat(section(6, vec(this.globals)));
  if (this.exports.length) out = out.concat(section(7, vec(this.exports)));
  if (this.start !== undefined) out = out.concat(section(8, uleb(this.start)));
  if (this.elems.length) out = out.concat(section(9, vec(this.elems)));
  if (this.funcs.length) {
    var bodies = this.funcs.map(function (it) {
      var body = vec(it.locals).concat(it.body, [0x0b]);
      return uleb(body.length).concat(body);
    });
    out = out.concat(section(10, vec(bodies)));
  }
  if (this.data.length) out = out.concat(section(11, vec(this.data)));
  for (var index = 0; index < this.custom.length; index++) {
    out = out.concat(section(0, this.custom[index]));
  }
  return new Uint8Array(out);
};

// The smallest module there is.
function emptyModuleBytes() {
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
}
