(function (){"use strict";// build2/tmp/bun/ffi.ts
var FFIBuilder = function(params, returnType, functionToCall, name) {
  const hasReturnType = typeof FFIType[returnType] === "number" && FFIType[returnType] !== FFIType.void;
  var paramNames = new @Array(params.length);
  var args = new @Array(params.length);
  for (let i = 0;i < params.length; i++) {
    paramNames[i] = `p${i}`;
    const wrapper = ffiWrappers[FFIType[params[i]]];
    if (wrapper) {
      args[i] = `(val=>${wrapper})(p${i})`;
    } else {
      @throwTypeError(`Unsupported type ${params[i]}. Must be one of: ${Object.keys(FFIType).sort().join(", ")}`);
    }
  }
  var code = `functionToCall(${args.join(", ")})`;
  if (hasReturnType) {
    if (FFIType[returnType] === FFIType.cstring) {
      code = `return new __GlobalBunCString(${code})`;
    } else {
      code = `return ${code}`;
    }
  }
  var func = new Function("functionToCall", ...paramNames, code);
  Object.defineProperty(func, "name", {
    value: name
  });
  var wrap;
  switch (paramNames.length) {
    case 0:
      wrap = () => func(functionToCall);
      break;
    case 1:
      wrap = (arg1) => func(functionToCall, arg1);
      break;
    case 2:
      wrap = (arg1, arg2) => func(functionToCall, arg1, arg2);
      break;
    case 3:
      wrap = (arg1, arg2, arg3) => func(functionToCall, arg1, arg2, arg3);
      break;
    case 4:
      wrap = (arg1, arg2, arg3, arg4) => func(functionToCall, arg1, arg2, arg3, arg4);
      break;
    case 5:
      wrap = (arg1, arg2, arg3, arg4, arg5) => func(functionToCall, arg1, arg2, arg3, arg4, arg5);
      break;
    case 6:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6) => func(functionToCall, arg1, arg2, arg3, arg4, arg5, arg6);
      break;
    case 7:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6, arg7) => func(functionToCall, arg1, arg2, arg3, arg4, arg5, arg6, arg7);
      break;
    case 8:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) => func(functionToCall, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8);
      break;
    case 9:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) => func(functionToCall, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9);
      break;
    default: {
      wrap = (...args2) => func(functionToCall, ...args2);
      break;
    }
  }
  wrap.native = functionToCall;
  wrap.ptr = functionToCall.ptr;
  return wrap;
};
var dlopen = function(path, options) {
  const result = nativeDLOpen(path, options);
  if (result instanceof Error)
    throw result;
  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    if (options[key]?.args?.length || FFIType[options[key]?.returns] === FFIType.cstring) {
      result.symbols[key] = FFIBuilder(options[key].args ?? [], options[key].returns ?? FFIType.void, symbol, path.includes("/") ? `${key} (${path.split("/").pop()})` : `${key} (${path})`);
    } else {
      result.symbols[key].native = result.symbols[key];
    }
  }
  result.close = result.close.bind(result);
  return result;
};
var linkSymbols = function(options) {
  const result = nativeLinkSymbols(options);
  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    if (options[key]?.args?.length || FFIType[options[key]?.returns] === FFIType.cstring) {
      result.symbols[key] = FFIBuilder(options[key].args ?? [], options[key].returns ?? FFIType.void, symbol, key);
    } else {
      result.symbols[key].native = result.symbols[key];
    }
  }
  return result;
};
var onCloseCFunction = function(close) {
  close();
};
var CFunction = function(options) {
  const identifier = `CFunction${cFunctionI++}`;
  var result = linkSymbols({
    [identifier]: options
  });
  var hasClosed = false;
  var close = result.close.bind(result);
  result.symbols[identifier].close = () => {
    if (hasClosed || !close)
      return;
    hasClosed = true;
    close();
    close = @undefined;
  };
  cFunctionRegistry ||= new FinalizationRegistry(onCloseCFunction);
  cFunctionRegistry.register(result.symbols[identifier], result.symbols[identifier].close);
  return result.symbols[identifier];
};
var $;
var FFIType = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  "11": 11,
  "12": 12,
  "13": 13,
  "14": 14,
  "15": 15,
  "16": 16,
  "17": 17,
  bool: 11,
  c_int: 5,
  c_uint: 6,
  char: 0,
  "char*": 12,
  double: 9,
  f32: 10,
  f64: 9,
  float: 10,
  i16: 3,
  i32: 5,
  i64: 7,
  i8: 1,
  int: 5,
  int16_t: 3,
  int32_t: 5,
  int64_t: 7,
  int8_t: 1,
  isize: 7,
  u16: 4,
  u32: 6,
  u64: 8,
  u8: 2,
  uint16_t: 4,
  uint32_t: 6,
  uint64_t: 8,
  uint8_t: 2,
  usize: 8,
  "void*": 12,
  ptr: 12,
  pointer: 12,
  void: 13,
  cstring: 14,
  i64_fast: 15,
  u64_fast: 16,
  function: 17,
  callback: 17,
  fn: 17
};
var suffix = "dylib";
var ffi = globalThis.Bun.FFI;
var ptr = (arg1, arg2) => typeof arg2 === "undefined" ? ffi.ptr(arg1) : ffi.ptr(arg1, arg2);
var toBuffer = ffi.toBuffer;
var toArrayBuffer = ffi.toArrayBuffer;
var viewSource = ffi.viewSource;
var BunCString = ffi.CString;
var nativeLinkSymbols = ffi.linkSymbols;
var nativeDLOpen = ffi.dlopen;
var nativeCallback = ffi.callback;
var closeCallback = ffi.closeCallback;
delete ffi.callback;
delete ffi.closeCallback;

class JSCallback {
  constructor(cb, options) {
    const { ctx, ptr: ptr2 } = nativeCallback(options, cb);
    this.#ctx = ctx;
    this.ptr = ptr2;
    this.#threadsafe = !!options?.threadsafe;
  }
  ptr;
  #ctx;
  #threadsafe;
  get threadsafe() {
    return this.#threadsafe;
  }
  [Symbol.toPrimitive]() {
    const { ptr: ptr2 } = this;
    return typeof ptr2 === "number" ? ptr2 : 0;
  }
  close() {
    const ctx = this.#ctx;
    this.ptr = null;
    this.#ctx = null;
    if (ctx) {
      closeCallback(ctx);
    }
  }
}

class CString extends @String {
  constructor(ptr2, byteOffset, byteLength) {
    super(ptr2 ? typeof byteLength === "number" && Number.isSafeInteger(byteLength) ? BunCString(ptr2, byteOffset || 0, byteLength) : BunCString(ptr2) : "");
    this.ptr = typeof ptr2 === "number" ? ptr2 : 0;
    if (typeof byteOffset !== "undefined") {
      this.byteOffset = byteOffset;
    }
    if (typeof byteLength !== "undefined") {
      this.byteLength = byteLength;
    }
  }
  ptr;
  byteOffset;
  byteLength;
  #cachedArrayBuffer;
  get arrayBuffer() {
    if (this.#cachedArrayBuffer) {
      return this.#cachedArrayBuffer;
    }
    if (!this.ptr) {
      return this.#cachedArrayBuffer = new @ArrayBuffer(0);
    }
    return this.#cachedArrayBuffer = toArrayBuffer(this.ptr, this.byteOffset, this.byteLength);
  }
}
Object.defineProperty(globalThis, "__GlobalBunCString", {
  value: CString,
  enumerable: false,
  configurable: false
});
var ffiWrappers = new @Array(18);
var char = "val|0";
ffiWrappers.fill(char);
ffiWrappers[FFIType.uint8_t] = "val<0?0:val>=255?255:val|0";
ffiWrappers[FFIType.int16_t] = "val<=-32768?-32768:val>=32768?32768:val|0";
ffiWrappers[FFIType.uint16_t] = "val<=0?0:val>=65536?65536:val|0";
ffiWrappers[FFIType.int32_t] = "val|0";
ffiWrappers[FFIType.uint32_t] = "val<=0?0:val>=0xffffffff?0xffffffff:+val||0";
ffiWrappers[FFIType.i64_fast] = `{
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(-Number.MAX_SAFE_INTEGER)) {
      return Number(val).valueOf() || 0;
    }

    return val;
  }

  return !val ? 0 : +val || 0;
}`;
ffiWrappers[FFIType.i64_fast] = `{
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(-Number.MAX_SAFE_INTEGER)) {
      return Number(val).valueOf() || 0;
    }

    return val;
  }

  return !val ? 0 : +val || 0;
}`;
ffiWrappers[FFIType.u64_fast] = `{
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= 0) {
      return Number(val).valueOf() || 0;
    }

    return val;
  }

  return !val ? 0 : +val || 0;
}`;
ffiWrappers[FFIType.int64_t] = `{
  if (typeof val === "bigint") {
    return val;
  }

  if (typeof val === "number") {
    return BigInt(val || 0);
  }

  return BigInt(+val || 0);
}`;
ffiWrappers[FFIType.uint64_t] = `{
  if (typeof val === "bigint") {
    return val;
  }

  if (typeof val === "number") {
    return val <= 0 ? BigInt(0) : BigInt(val || 0);
  }

  return BigInt(+val || 0);
}`;
ffiWrappers[FFIType.u64_fast] = `{
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(0)) return Number(val);
    return val;
  }

  return typeof val === "number" ? (val <= 0 ? 0 : +val || 0) : +val || 0;
}`;
ffiWrappers[FFIType.uint16_t] = `{
  const ret = (typeof val === "bigint" ? Number(val) : val) | 0;
  return ret <= 0 ? 0 : ret > 0xffff ? 0xffff : ret;
}`;
ffiWrappers[FFIType.double] = `{
  if (typeof val === "bigint") {
    if (val.valueOf() < BigInt(Number.MAX_VALUE)) {
      return Math.abs(Number(val).valueOf()) + 0.00000000000001 - 0.00000000000001;
    }
  }

  if (!val) {
    return 0 + 0.00000000000001 - 0.00000000000001;
  }

  return val + 0.00000000000001 - 0.00000000000001;
}`;
ffiWrappers[FFIType.float] = ffiWrappers[10] = `{
  return Math.fround(val);
}`;
ffiWrappers[FFIType.bool] = `{
  return !!val;
}`;
Object.defineProperty(globalThis, "__GlobalBunFFIPtrFunctionForWrapper", {
  value: ptr,
  enumerable: false,
  configurable: true
});
ffiWrappers[FFIType.cstring] = ffiWrappers[FFIType.pointer] = `{
  if (typeof val === "number") return val;
  if (!val) {
    return null;
  }

  if (ArrayBuffer.isView(val) || val instanceof ArrayBuffer) {
    return __GlobalBunFFIPtrFunctionForWrapper(val);
  }

  if (typeof val === "string") {
    throw new TypeError("To convert a string to a pointer, encode it as a buffer");
  }

  throw new TypeError(\`Unable to convert \${ val } to a pointer\`);
}`;
ffiWrappers[FFIType.function] = `{
  if (typeof val === "number") {
    return val;
  }

  if (typeof val === "bigint") {
    return Number(val);
  }

  var ptr = val && val.ptr;

  if (!ptr) {
    throw new TypeError("Expected function to be a JSCallback or a number");
  }

  return ptr;
}`;
var native = {
  dlopen: nativeDLOpen,
  callback: () => {
    throw new Error("Deprecated. Use new JSCallback(options, fn) instead");
  }
};
var cFunctionI = 0;
var cFunctionRegistry;
var read = ffi.read;
$ = {
  CFunction,
  CString,
  FFIType,
  JSCallback,
  dlopen,
  linkSymbols,
  native,
  ptr,
  read,
  suffix,
  toArrayBuffer,
  toBuffer,
  viewSource
};
return $})
