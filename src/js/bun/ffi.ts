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
  napi_env: 18,
  napi_value: 19,
  buffer: 20,
  buffer_length: 21,
  buffer_bytelength: 21,
};

const suffix = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";

var ffi = globalThis.Bun.FFI;
const ptr = (arg1, arg2) => (typeof arg2 === "undefined" ? ffi.ptr(arg1) : ffi.ptr(arg1, arg2));
const toBuffer = ffi.toBuffer;
const toArrayBuffer = ffi.toArrayBuffer;
const nativeViewSource = ffi.viewSource;

const nativeLinkSymbols = ffi.linkSymbols;
const nativeDLOpen = ffi.dlopen;
const nativeCallback = ffi.callback;
const closeCallback = ffi.closeCallback;
const nativeCFunction = ffi.cfunction;
delete ffi.callback;
delete ffi.closeCallback;
delete ffi.cfunction;

class JSCallback {
  constructor(cb, options) {
    const cell = nativeCallback(options, cb);
    if (Error.isError(cell)) throw cell;
    Object.setPrototypeOf(cell, (new.target ?? JSCallback).prototype);
    return cell;
  }

  [Symbol.toPrimitive]() {
    const { ptr } = this;
    return typeof ptr === "number" ? ptr : 0;
  }

  close() {
    if (!(this instanceof JSCallback)) {
      throw new TypeError("JSCallback.prototype.close called on an incompatible receiver");
    }
    closeCallback(this);
  }

  [Symbol.dispose]() {
    this.close();
  }
}

const CString = ffi.CString;

function FFIBuilder(params, functionToCall, name) {
  var paramNames = new Array(params.length);
  for (let i = 0; i < params.length; i++) paramNames[i] = `p${i}`;

  var code = `return (v=>v?new __CString(v):null)(functionToCall(${paramNames.join(", ")}))`;

  var func = new Function("functionToCall", "__CString", ...paramNames, code);
  Object.defineProperty(func, "name", {
    value: name,
  });

  // variadic arguments can be expensive
  // most FFI functions are going to be < 5 arguments
  // so we just inline it
  var wrap;
  switch (paramNames.length) {
    case 0:
      wrap = () => func(functionToCall, CString);
      break;
    case 1:
      wrap = arg1 => func(functionToCall, CString, arg1);
      break;
    case 2:
      wrap = (arg1, arg2) => func(functionToCall, CString, arg1, arg2);
      break;
    case 3:
      wrap = (arg1, arg2, arg3) => func(functionToCall, CString, arg1, arg2, arg3);
      break;
    case 4:
      wrap = (arg1, arg2, arg3, arg4) => func(functionToCall, CString, arg1, arg2, arg3, arg4);
      break;
    case 5:
      wrap = (arg1, arg2, arg3, arg4, arg5) => func(functionToCall, CString, arg1, arg2, arg3, arg4, arg5);
      break;
    case 6:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6) => func(functionToCall, CString, arg1, arg2, arg3, arg4, arg5, arg6);
      break;
    case 7:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6, arg7) =>
        func(functionToCall, CString, arg1, arg2, arg3, arg4, arg5, arg6, arg7);
      break;
    case 8:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) =>
        func(functionToCall, CString, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8);
      break;
    case 9:
      wrap = (arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) =>
        func(functionToCall, CString, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9);
      break;
    default: {
      wrap = (...args) => func(functionToCall, CString, ...args);
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

const ccFn = $newRustFunction("ffi.rs", "Bun__FFI__cc", 1);

function normalizePath(path) {
  if (typeof path === "string" && path?.startsWith?.("file:")) {
    // import.meta.url returns a file: URL
    // https://github.com/oven-sh/bun/issues/10304
    path = Bun.fileURLToPath(path);
  } else if (typeof path === "object" && path) {
    if (path instanceof URL) {
      // This is mostly for import.meta.resolve()
      // https://github.com/oven-sh/bun/issues/10304
      path = Bun.fileURLToPath(path as URL);
    } else if ($inheritsBlob(path)) {
      // must be a Bun.file() blob
      // https://discord.com/channels/876711213126520882/1230114905898614794/1230114905898614794
      path = path.name;
    }
  }

  return path;
}

function dlopen(path, options) {
  path = normalizePath(path);

  const result = nativeDLOpen(path, options);
  if (Error.isError(result)) throw result;

  // Bind it because it's a breaking change to not do so
  // Previously, it didn't need to be bound
  result.close = result.close.bind(result);

  return result;
}

function cc(options) {
  if (!$isObject(options)) {
    throw new Error("Expected options to be an object");
  }

  let path = options?.source;
  if (!path) {
    throw new Error("Expected source to be a string to a file path");
  }
  if ($isJSArray(path)) {
    for (let i = 0; i < path.length; i++) {
      path[i] = normalizePath(path[i]);
    }
  } else {
    path = normalizePath(path);
  }
  options.source = path;

  const result = ccFn(options);
  if (Error.isError(result)) throw result;

  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    const desc = options.symbols?.[key];
    if (FFIType[desc?.returns as string] === FFIType.cstring) {
      result.symbols[key] = FFIBuilder(
        desc.args ?? [],
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

  // Bind it because it's a breaking change to not do so
  // Previously, it didn't need to be bound
  result.close = result.close.bind(result);

  return result;
}

function viewSource(symbols, isCallback?) {
  const result = nativeViewSource(symbols, isCallback);
  if (Error.isError(result)) throw result;
  return result;
}

function linkSymbols(options) {
  const result = nativeLinkSymbols(options);
  if (Error.isError(result)) throw result;
  return result;
}

var cFunctionI = 0;
function closeJSCFFICFunction() {}
function CFunction(options) {
  const identifier = `CFunction${cFunctionI++}`;

  const fn = nativeCFunction(options, identifier);
  if (Error.isError(fn)) throw fn;
  fn.close = closeJSCFFICFunction;
  return fn;
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
  cc,
};
