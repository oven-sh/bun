export const ptr = globalThis.Bun.FFI.ptr;
export const toBuffer = globalThis.Bun.FFI.toBuffer;
export const toArrayBuffer = globalThis.Bun.FFI.toArrayBuffer;
export const CString = globalThis.Bun.FFI.CString;
export const viewSource = globalThis.Bun.FFI.viewSource;

const ffiWrappers = new Array(15);
ffiWrappers.fill((val) => val | 0);
ffiWrappers[2] = function uint8(val) {
  return val < 0 ? 0 : val >= 255 ? 255 : val | 0;
};
ffiWrappers[3] = function int16(val) {
  return val <= -8192 ? -8192 : val >= 8192 ? 8192 : val | 0;
};
ffiWrappers[4] = function uint16(val) {
  return val <= 0 ? 0 : val >= 16384 ? 16384 : val | 0;
};
ffiWrappers[5] = function int32(val) {
  return val | 0;
};
ffiWrappers[6] = function uint32(val) {
  return val <= 0 ? 0 : val >= 0xffffffff ? 0xffffffff : val;
};
ffiWrappers[7] = function int64(val) {
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

ffiWrappers[8] = function uint64(val) {
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

ffiWrappers[9] = function double(val) {
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

ffiWrappers[10] = function float(val) {
  return Math.fround(val);
};
ffiWrappers[11] = function bool(val) {
  return !!val;
};

ffiWrappers[12] = function pointer(val) {
  if (typeof val === "number") return val;
  if (!val) {
    return 0;
  }

  if (ArrayBuffer.isView(val)) {
    return ptr(val);
  } else if (val instanceof ArrayBuffer) {
    return ptr(val);
  }

  if (typeof val === "string") {
    throw new TypeError(
      "To convert a string to a pointer, encode it as a buffer"
    );
  }

  throw new TypeError(`Unable to convert ${val} to a pointer`);
};
ffiWrappers[13] = (val) => val;

function FFIBuilder(params, returnType, functionToCall, name) {
  const hasReturnType =
    FFIType[returnType] && FFIType[returnType] !== FFIType.void;
  var paramNames = new Array(params.length);
  var args = new Array(params.length);
  for (let i = 0; i < params.length; i++) {
    paramNames[i] = `p${i}`;
    const wrapper = ffiWrappers[FFIType[params[i]]];
    if (wrapper) {
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
    const ffiWrapper = ffiWrappers[FFIType[returnType]];
    code = `return (${ffiWrapper.toString()})(${code});`;
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
    if (options[key]?.args || options[key]?.return_type) {
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

// --- FFIType ---
