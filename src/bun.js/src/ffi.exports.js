// --- FFIType ---

var ffi = globalThis.Bun.FFI;
export const ptr = (arg1, arg2) => (typeof arg2 === "undefined" ? ffi.ptr(arg1) : ffi.ptr(arg1, arg2));
export const toBuffer = ffi.toBuffer;
export const toArrayBuffer = ffi.toArrayBuffer;
export const viewSource = ffi.viewSource;

const BunCString = ffi.CString;
const nativeLinkSymbols = ffi.linkSymbols;
const nativeDLOpen = ffi.dlopen;
const nativeCallback = ffi.callback;
const closeCallback = ffi.closeCallback;
delete ffi.callback;
delete ffi.closeCallback;

export class JSCallback {
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

export class CString extends String {
  constructor(ptr, byteOffset, byteLength) {
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

var char = val => val | 0;
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
// we never want to return NaN
ffiWrappers[FFIType.uint32_t] = function uint32(val) {
  return val <= 0 ? 0 : val >= 0xffffffff ? 0xffffffff : +val || 0;
};
ffiWrappers[FFIType.i64_fast] = function int64(val) {
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(-Number.MAX_SAFE_INTEGER)) {
      return Number(val).valueOf() || 0;
    }

    return val;
  }

  return !val ? 0 : +val || 0;
};

ffiWrappers[FFIType.u64_fast] = function u64_fast(val) {
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= 0) {
      return Number(val).valueOf() || 0;
    }

    return val;
  }

  return !val ? 0 : +val || 0;
};

ffiWrappers[FFIType.int64_t] = function int64(val) {
  if (typeof val === "bigint") {
    return val;
  }

  if (typeof val === "number") {
    return BigInt(val || 0);
  }

  return BigInt(+val || 0);
};

ffiWrappers[FFIType.uint64_t] = function uint64(val) {
  if (typeof val === "bigint") {
    return val;
  }

  if (typeof val === "number") {
    return val <= 0 ? BigInt(0) : BigInt(val || 0);
  }

  return BigInt(+val || 0);
};

ffiWrappers[FFIType.u64_fast] = function u64_fast(val) {
  if (typeof val === "bigint") {
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(0)) return Number(val);
    return val;
  }

  return typeof val === "number" ? (val <= 0 ? 0 : +val || 0) : +val || 0;
};

ffiWrappers[FFIType.uint16_t] = function uint16(val) {
  const ret = (typeof val === "bigint" ? Number(val) : val) | 0;
  return ret <= 0 ? 0 : ret > 0xffff ? 0xffff : ret;
};

ffiWrappers[FFIType.double] = function double(val) {
  if (typeof val === "bigint") {
    if (val.valueOf() < BigInt(Number.MAX_VALUE)) {
      return Math.abs(Number(val).valueOf()) + 0.00000000000001 - 0.00000000000001;
    }
  }

  if (!val) {
    return 0 + 0.00000000000001 - 0.00000000000001;
  }

  return val + 0.00000000000001 - 0.00000000000001;
};

ffiWrappers[FFIType.float] = ffiWrappers[10] = function float(val) {
  return Math.fround(val);
};
ffiWrappers[FFIType.bool] = function bool(val) {
  return !!val;
};

// This prevents an extra property getter in potentially hot code
Object.defineProperty(globalThis, "__GlobalBunFFIPtrFunctionForWrapper", {
  value: ptr,
  enumerable: false,
  configurable: true,
});

ffiWrappers[FFIType.cstring] = ffiWrappers[FFIType.pointer] = function pointer(val) {
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

  throw new TypeError(`Unable to convert ${val} to a pointer`);
};

function cstringReturnType(val) {
  return new __GlobalBunCString(val);
}

ffiWrappers[FFIType.function] = function functionType(val) {
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
};

function FFIBuilder(params, returnType, functionToCall, name) {
  const hasReturnType = typeof FFIType[returnType] === "number" && FFIType[returnType] !== FFIType.void;
  var paramNames = new Array(params.length);
  var args = new Array(params.length);
  for (let i = 0; i < params.length; i++) {
    paramNames[i] = `p${i}`;
    const wrapper = ffiWrappers[FFIType[params[i]]];
    if (wrapper) {
      // doing this inline benchmarked about 4x faster than referencing
      args[i] = `(${wrapper.toString()})(p${i})`;
    } else {
      throw new TypeError(`Unsupported type ${params[i]}. Must be one of: ${Object.keys(FFIType).sort().join(", ")}`);
    }
  }

  var code = `functionToCall(${args.join(", ")})`;
  if (hasReturnType) {
    if (FFIType[returnType] === FFIType.cstring) {
      code = `return (${cstringReturnType.toString()})(${code})`;
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

export const native = {
  dlopen: nativeDLOpen,
  callback: () => {
    throw new Error("Deprecated. Use new JSCallback(options, fn) instead");
  },
};

export function dlopen(path, options) {
  const result = nativeDLOpen(path, options);

  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    if (options[key]?.args?.length || FFIType[options[key]?.returns] === FFIType.cstring) {
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

export function linkSymbols(options) {
  const result = nativeLinkSymbols(options);

  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    if (options[key]?.args?.length || FFIType[options[key]?.returns] === FFIType.cstring) {
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
export function CFunction(options) {
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

export const read = ffi.read;
