// --- FFIType ---

export const ptr = globalThis.Bun.FFI.ptr;
export const toBuffer = globalThis.Bun.FFI.toBuffer;
export const toArrayBuffer = globalThis.Bun.FFI.toArrayBuffer;
export const viewSource = globalThis.Bun.FFI.viewSource;

const BunCString = globalThis.Bun.FFI.CString;

export class CString extends String {
  constructor(ptr, byteOffset, byteLength) {
    super(
      ptr
        ? typeof byteLength === "number" && Number.isSafeInteger(byteLength)
          ? new BunCString(ptr, byteOffset || 0, byteLength)
          : new BunCString(ptr)
        : ""
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

    return (this.#cachedArrayBuffer = toArrayBuffer(
      this.ptr,
      this.byteOffset,
      this.byteLength
    ));
  }
}
Object.defineProperty(globalThis, "__GlobalBunCString", {
  value: CString,
  enumerable: false,
  configurable: false,
});

const ffiWrappers = new Array(15);
var char = (val) => val | 0;
ffiWrappers.fill(char);
ffiWrappers[FFIType.uint8_t] = function uint8(val) {
  return val < 0 ? 0 : val >= 255 ? 255 : val | 0;
};
ffiWrappers[FFIType.int16_t] = function int16(val) {
  return val <= -8192 ? -8192 : val >= 8192 ? 8192 : val | 0;
};
ffiWrappers[FFIType.uint16_t] = function uint16(val) {
  return val <= 0 ? 0 : val >= 16384 ? 16384 : val | 0;
};
ffiWrappers[FFIType.int32_t] = function int32(val) {
  return val | 0;
};
ffiWrappers[FFIType.uint32_t] = function uint32(val) {
  return val <= 0 ? 0 : val >= 0xffffffff ? 0xffffffff : val;
};
ffiWrappers[FFIType.int64_t] = function int64(val) {
  if (typeof val === "bigint") {
    if (val < Number.MAX_VALUE) {
      return Number(val).valueOf();
    }
  }

  if (!val) {
    return 0;
  }

  return val;
};

ffiWrappers[FFIType.uint16_t] = function uint64(val) {
  if (typeof val === "bigint") {
    if (val < Number.MAX_VALUE) {
      return Math.abs(Number(val).valueOf());
    }
  }

  if (!val) {
    return 0;
  }

  return Math.abs(val);
};

ffiWrappers[FFIType.double] = function double(val) {
  if (typeof val === "bigint") {
    if (val.valueOf() < BigInt(Number.MAX_VALUE)) {
      return (
        Math.abs(Number(val).valueOf()) + 0.00000000000001 - 0.00000000000001
      );
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

ffiWrappers[FFIType.cstring] = ffiWrappers[FFIType.pointer] = function pointer(
  val
) {
  if (typeof val === "number") return val;
  if (!val) {
    return 0;
  }

  if (ArrayBuffer.isView(val) || val instanceof ArrayBuffer) {
    return ptr(val);
  }

  if (typeof val === "string") {
    throw new TypeError(
      "To convert a string to a pointer, encode it as a buffer"
    );
  }

  throw new TypeError(`Unable to convert ${val} to a pointer`);
};

function cstringReturnType(val) {
  return new __GlobalBunCString(val);
}

function FFIBuilder(params, returnType, functionToCall, name) {
  const hasReturnType =
    typeof FFIType[returnType] === "number" &&
    FFIType[returnType] !== FFIType.void;
  var paramNames = new Array(params.length);
  var args = new Array(params.length);
  for (let i = 0; i < params.length; i++) {
    paramNames[i] = `p${i}`;
    const wrapper = ffiWrappers[FFIType[params[i]]];
    if (wrapper) {
      // doing this inline benchmarked about 4x faster than referencing
      args[i] = `(${wrapper.toString()})(p${i})`;
    } else {
      throw new TypeError(
        `Unsupported type ${params[i]}. Must be one of: ${Object.keys(FFIType)
          .sort()
          .join(", ")}`
      );
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
  const wrap = (...args) => func(functionToCall, ...args);
  wrap.native = functionToCall;

  return wrap;
}

const nativeDLOpen = globalThis.Bun.FFI.dlopen;
const nativeCallback = globalThis.Bun.FFI.callback;
export const native = {
  dlopen: nativeDLOpen,
  callback: nativeCallback,
};

export function dlopen(path, options) {
  const result = nativeDLOpen(path, options);

  for (let key in result.symbols) {
    var symbol = result.symbols[key];
    if (
      options[key]?.args?.length ||
      FFIType[options[key]?.return_type] === FFIType.cstring
    ) {
      result.symbols[key] = FFIBuilder(
        options[key].args ?? [],
        options[key].return_type ?? FFIType.void,
        symbol,
        // in stacktraces:
        // instead of
        //    "/usr/lib/sqlite3.so"
        // we want
        //    "sqlite3_get_version() - sqlit3.so"
        path.includes("/")
          ? `${key} (${path.split("/").pop()})`
          : `${key} (${path})`
      );
    } else {
      // consistentcy
      result.native = result;
    }
  }

  return result;
}

export function callback(options) {
  const result = nativeCallback(options);

  if (options.args || options.return_type) {
    return FFIBuilder(
      options.args ?? [],
      options.return_type ?? FFIType.void,
      result,
      "callback"
    );
  }

  return result;
}
