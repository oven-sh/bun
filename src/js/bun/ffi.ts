const FFIType = {
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
  fn: 17,
};

const suffix = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";

declare const __GlobalBunFFIPtrFunctionForWrapper: typeof ptr;
declare const __GlobalBunCString: typeof CString;

var ffi = globalThis.Bun.FFI;
const ptr = (arg1, arg2) => (typeof arg2 === "undefined" ? ffi.ptr(arg1) : ffi.ptr(arg1, arg2));
const toBuffer = ffi.toBuffer;
const toArrayBuffer = ffi.toArrayBuffer;
const viewSource = ffi.viewSource;

const BunCString = ffi.CString;
const nativeLinkSymbols = ffi.linkSymbols;
const nativeDLOpen = ffi.dlopen;
const nativeCallback = ffi.callback;
const closeCallback = ffi.closeCallback;
delete ffi.callback;
delete ffi.closeCallback;

class JSCallback {
  constructor(cb, options) {
    const { ctx, ptr } = nativeCallback(options, cb);
    this.#ctx = ctx;
    this.ptr = ptr;
    this.#threadsafe = !!options?.threadsafe;
  }

  ptr;
  #ctx;
  #threadsafe;

  get threadsafe() {
    return this.#threadsafe;
  }

  [Symbol.toPrimitive]() {
    const { ptr } = this;
    return typeof ptr === "number" ? ptr : 0;
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

class CString extends String {
  constructor(ptr, byteOffset?, byteLength?) {
    super(
      ptr
        ? typeof byteLength === "number" && Number.isSafeInteger(byteLength)
          ? new BunCString(ptr, byteOffset || 0, byteLength)
          : new BunCString(ptr)
        : "",
    );
    this.ptr = typeof ptr === "number" ? ptr : 0;
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
      return (this.#cachedArrayBuffer = new ArrayBuffer(0));
    }

    return (this.#cachedArrayBuffer = toArrayBuffer(this.ptr, this.byteOffset, this.byteLength));
  }
}
Object.defineProperty(globalThis, "__GlobalBunCString", {
  value: CString,
  enumerable: false,
  configurable: false,
});

const ffiWrappers = new Array(18);

var char = "val|0";
ffiWrappers.fill(char);
ffiWrappers[FFIType.uint8_t] = "val<0?0:val>=255?255:val|0";
ffiWrappers[FFIType.int16_t] = "val<=-32768?-32768:val>=32768?32768:val|0";
ffiWrappers[FFIType.uint16_t] = "val<=0?0:val>=65536?65536:val|0";
ffiWrappers[FFIType.int32_t] = "val|0";
// we never want to return NaN
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

// This prevents an extra property getter in potentially hot code
Object.defineProperty(globalThis, "__GlobalBunFFIPtrFunctionForWrapper", {
  value: ptr,
  enumerable: false,
  configurable: true,
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

function FFIBuilder(params, returnType, functionToCall, name) {
  const hasReturnType = typeof FFIType[returnType] === "number" && FFIType[returnType as string] !== FFIType.void;
  var paramNames = new Array(params.length);
  var args = new Array(params.length);
  for (let i = 0; i < params.length; i++) {
    paramNames[i] = `p${i}`;
    const wrapper = ffiWrappers[FFIType[params[i]]];
    if (wrapper) {
      // doing this inline benchmarked about 4x faster than referencing
      args[i] = `(val=>${wrapper})(p${i})`;
    } else {
      throw new TypeError(`Unsupported type ${params[i]}. Must be one of: ${Object.keys(FFIType).sort().join(", ")}`);
    }
  }

  var code = `functionToCall(${args.join(", ")})`;
  if (hasReturnType) {
    if (FFIType[returnType as string] === FFIType.cstring) {
      code = `return new __GlobalBunCString(${code})`;
    } else {
      code = `return ${code}`;
    }
  }

  var func = new Function("functionToCall", ...paramNames, code);
  Object.defineProperty(func, "name", {
    value: name,
  });

  // variadic arguments can be expensive
  // most FFI functions are going to be < 5 arguments
  // so we just inline it
  var wrap;
  switch (paramNames.length) {
    case 0:
      wrap = () => func(functionToCall);
      break;
    case 1:
      wrap = arg1 => func(functionToCall, arg1);
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
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6, arg7) =>
        func(functionToCall, arg1, arg2, arg3, arg4, arg5, arg6, arg7);
      break;
    case 8:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) =>
        func(functionToCall, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8);
      break;
    case 9:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) =>
        func(functionToCall, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9);
      break;
    default: {
      wrap = (...args) => func(functionToCall, ...args);
      break;
    }
  }

  wrap.native = functionToCall;
  wrap.ptr = functionToCall.ptr;
  return wrap;
}

const native = {
  dlopen: nativeDLOpen,
  callback: () => {
    throw new Error("Deprecated. Use new JSCallback(options, fn) instead");
  },
};

function dlopen(path, options) {
  const result = nativeDLOpen(path, options);

  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    if (options[key]?.args?.length || FFIType[options[key]?.returns as string] === FFIType.cstring) {
      result.symbols[key] = FFIBuilder(
        options[key].args ?? [],
        options[key].returns ?? FFIType.void,
        symbol,
        // in stacktraces:
        // instead of
        //    "/usr/lib/sqlite3.so"
        // we want
        //    "sqlite3_get_version() - sqlit3.so"
        path.includes("/") ? `${key} (${path.split("/").pop()})` : `${key} (${path})`,
      );
    } else {
      // consistentcy
      result.symbols[key].native = result.symbols[key];
    }
  }

  return result;
}

function linkSymbols(options) {
  const result = nativeLinkSymbols(options);

  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    if (options[key]?.args?.length || FFIType[options[key]?.returns as string] === FFIType.cstring) {
      result.symbols[key] = FFIBuilder(options[key].args ?? [], options[key].returns ?? FFIType.void, symbol, key);
    } else {
      // consistentcy
      result.symbols[key].native = result.symbols[key];
    }
  }

  return result;
}

var cFunctionI = 0;
var cFunctionRegistry;
function onCloseCFunction(close) {
  close();
}
function CFunction(options) {
  const identifier = `CFunction${cFunctionI++}`;
  var result = linkSymbols({
    [identifier]: options,
  });
  var hasClosed = false;
  var close = result.close;
  result.symbols[identifier].close = () => {
    if (hasClosed || !close) return;
    hasClosed = true;
    close();
    close = undefined;
  };

  cFunctionRegistry ||= new FinalizationRegistry(onCloseCFunction);
  cFunctionRegistry.register(result.symbols[identifier], result.symbols[identifier].close);

  return result.symbols[identifier];
}

const read = ffi.read;

export default {
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
  viewSource,
};
