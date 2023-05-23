var cstringReturnType = function(val) {
  return new __GlobalBunCString(val);
}, FFIBuilder = function(params, returnType, functionToCall, name) {
  const hasReturnType = typeof FFIType[returnType] === "number" && FFIType[returnType] !== FFIType.void;
  var paramNames = new Array(params.length), args = new Array(params.length);
  for (let i = 0;i < params.length; i++) {
    paramNames[i] = `p${i}`;
    const wrapper = ffiWrappers[FFIType[params[i]]];
    if (wrapper)
      args[i] = `(${wrapper.toString()})(p${i})`;
    else
      throw new TypeError(`Unsupported type ${params[i]}. Must be one of: ${Object.keys(FFIType).sort().join(", ")}`);
  }
  var code = `functionToCall(${args.join(", ")})`;
  if (hasReturnType)
    if (FFIType[returnType] === FFIType.cstring)
      code = `return (${cstringReturnType.toString()})(${code})`;
    else
      code = `return ${code}`;
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
  return wrap.native = functionToCall, wrap.ptr = functionToCall.ptr, wrap;
};
function dlopen(path, options) {
  const result = nativeDLOpen(path, options);
  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    if (options[key]?.args?.length || FFIType[options[key]?.returns] === FFIType.cstring)
      result.symbols[key] = FFIBuilder(options[key].args ?? [], options[key].returns ?? FFIType.void, symbol, path.includes("/") ? `${key} (${path.split("/").pop()})` : `${key} (${path})`);
    else
      result.symbols[key].native = result.symbols[key];
  }
  return result;
}
function linkSymbols(options) {
  const result = nativeLinkSymbols(options);
  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    if (options[key]?.args?.length || FFIType[options[key]?.returns] === FFIType.cstring)
      result.symbols[key] = FFIBuilder(options[key].args ?? [], options[key].returns ?? FFIType.void, symbol, key);
    else
      result.symbols[key].native = result.symbols[key];
  }
  return result;
}
var onCloseCFunction = function(close) {
  close();
};
function CFunction(options) {
  const identifier = `CFunction${cFunctionI++}`;
  var result = linkSymbols({
    [identifier]: options
  }), hasClosed = !1, close = result.close;
  return result.symbols[identifier].close = () => {
    if (hasClosed || !close)
      return;
    hasClosed = !0, close(), close = void 0;
  }, cFunctionRegistry ||= new FinalizationRegistry(onCloseCFunction), cFunctionRegistry.register(result.symbols[identifier], result.symbols[identifier].close), result.symbols[identifier];
}
var suffix = "dylib", ffi = globalThis.Bun.FFI, ptr = (arg1, arg2) => typeof arg2 === "undefined" ? ffi.ptr(arg1) : ffi.ptr(arg1, arg2), toBuffer = ffi.toBuffer, toArrayBuffer = ffi.toArrayBuffer, viewSource = ffi.viewSource, BunCString = ffi.CString, nativeLinkSymbols = ffi.linkSymbols, nativeDLOpen = ffi.dlopen, nativeCallback = ffi.callback, closeCallback = ffi.closeCallback;
delete ffi.callback;
delete ffi.closeCallback;

class JSCallback {
  constructor(cb, options) {
    const { ctx, ptr: ptr2 } = nativeCallback(options, cb);
    this.#ctx = ctx, this.ptr = ptr2, this.#threadsafe = !!options?.threadsafe;
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
    if (this.ptr = null, this.#ctx = null, ctx)
      closeCallback(ctx);
  }
}

class CString extends String {
  constructor(ptr2, byteOffset, byteLength) {
    super(ptr2 ? typeof byteLength === "number" && Number.isSafeInteger(byteLength) ? new BunCString(ptr2, byteOffset || 0, byteLength) : new BunCString(ptr2) : "");
    if (this.ptr = typeof ptr2 === "number" ? ptr2 : 0, typeof byteOffset !== "undefined")
      this.byteOffset = byteOffset;
    if (typeof byteLength !== "undefined")
      this.byteLength = byteLength;
  }
  ptr;
  byteOffset;
  byteLength;
  #cachedArrayBuffer;
  get arrayBuffer() {
    if (this.#cachedArrayBuffer)
      return this.#cachedArrayBuffer;
    if (!this.ptr)
      return this.#cachedArrayBuffer = new ArrayBuffer(0);
    return this.#cachedArrayBuffer = toArrayBuffer(this.ptr, this.byteOffset, this.byteLength);
  }
}
Object.defineProperty(globalThis, "__GlobalBunCString", {
  value: CString,
  enumerable: !1,
  configurable: !1
});
var ffiWrappers = new Array(18), char = (val) => val | 0;
ffiWrappers.fill(char);
ffiWrappers[FFIType.uint8_t] = function uint8(val) {
  return val < 0 ? 0 : val >= 255 ? 255 : val | 0;
};
ffiWrappers[FFIType.int16_t] = function int16(val) {
  return val <= -32768 ? -32768 : val >= 32768 ? 32768 : val | 0;
};
ffiWrappers[FFIType.uint16_t] = function uint16(val) {
  return val <= 0 ? 0 : val >= 65536 ? 65536 : val | 0;
};
ffiWrappers[FFIType.int32_t] = function int32(val) {
  return val | 0;
};
ffiWrappers[FFIType.uint32_t] = function uint32(val) {
  return val <= 0 ? 0 : val >= 4294967295 ? 4294967295 : +val || 0;
};
ffiWrappers[FFIType.i64_fast] = function int64(val) {
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(-Number.MAX_SAFE_INTEGER))
      return Number(val).valueOf() || 0;
    return val;
  }
  return !val ? 0 : +val || 0;
};
ffiWrappers[FFIType.u64_fast] = function u64_fast(val) {
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= 0)
      return Number(val).valueOf() || 0;
    return val;
  }
  return !val ? 0 : +val || 0;
};
ffiWrappers[FFIType.int64_t] = function int642(val) {
  if (typeof val === "bigint")
    return val;
  if (typeof val === "number")
    return BigInt(val || 0);
  return BigInt(+val || 0);
};
ffiWrappers[FFIType.uint64_t] = function uint64(val) {
  if (typeof val === "bigint")
    return val;
  if (typeof val === "number")
    return val <= 0 ? BigInt(0) : BigInt(val || 0);
  return BigInt(+val || 0);
};
ffiWrappers[FFIType.u64_fast] = function u64_fast2(val) {
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(0))
      return Number(val);
    return val;
  }
  return typeof val === "number" ? val <= 0 ? 0 : +val || 0 : +val || 0;
};
ffiWrappers[FFIType.uint16_t] = function uint162(val) {
  const ret = (typeof val === "bigint" ? Number(val) : val) | 0;
  return ret <= 0 ? 0 : ret > 65535 ? 65535 : ret;
};
ffiWrappers[FFIType.double] = function double(val) {
  if (typeof val === "bigint") {
    if (val.valueOf() < BigInt(Number.MAX_VALUE))
      return Math.abs(Number(val).valueOf()) + 0.00000000000001 - 0.00000000000001;
  }
  if (!val)
    return 0;
  return val + 0.00000000000001 - 0.00000000000001;
};
ffiWrappers[FFIType.float] = ffiWrappers[10] = function float(val) {
  return Math.fround(val);
};
ffiWrappers[FFIType.bool] = function bool(val) {
  return !!val;
};
Object.defineProperty(globalThis, "__GlobalBunFFIPtrFunctionForWrapper", {
  value: ptr,
  enumerable: !1,
  configurable: !0
});
ffiWrappers[FFIType.cstring] = ffiWrappers[FFIType.pointer] = function pointer(val) {
  if (typeof val === "number")
    return val;
  if (!val)
    return null;
  if (ArrayBuffer.isView(val) || val instanceof ArrayBuffer)
    return __GlobalBunFFIPtrFunctionForWrapper(val);
  if (typeof val === "string")
    throw new TypeError("To convert a string to a pointer, encode it as a buffer");
  throw new TypeError(`Unable to convert ${val} to a pointer`);
};
ffiWrappers[FFIType.function] = function functionType(val) {
  if (typeof val === "number")
    return val;
  if (typeof val === "bigint")
    return Number(val);
  var ptr2 = val && val.ptr;
  if (!ptr2)
    throw new TypeError("Expected function to be a JSCallback or a number");
  return ptr2;
};
var native = {
  dlopen: nativeDLOpen,
  callback: () => {
    throw new Error("Deprecated. Use new JSCallback(options, fn) instead");
  }
}, cFunctionI = 0, cFunctionRegistry, read = ffi.read;
export {
  viewSource,
  toBuffer,
  toArrayBuffer,
  suffix,
  read,
  ptr,
  native,
  linkSymbols,
  dlopen,
  JSCallback,
  CString,
  CFunction
};

//# debugId=205F5E57742D87D864756e2164756e21
