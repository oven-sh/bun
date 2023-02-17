import * as Schema from "../../schema";
import { ByteBuffer } from "peechy";
import path from "path";
import { Loader } from "../schema";
// import { transform as sucraseTransform } from "sucrase";

export interface WebAssemblyModule {
  init(): number;
  transform(a: number): number;
  bun_malloc(a: number): number;
  bun_free(a: number): number;
  scan(a: number): number;
}

const wasm_imports_sym: symbol | string =
  process.env.NODE_ENV === "development"
    ? "wasm_imports"
    : Symbol("wasm_imports");

const ptr_converter = new ArrayBuffer(16);
const ptr_float = new BigUint64Array(ptr_converter);
const slice = new Uint32Array(ptr_converter);

const Wasi = {
  clock_time_get(clk_id, tp) {
    return Date.now();
  },
  environ_sizes_get() {
    debugger;
    return 0;
  },
  environ_get(__environ, environ_buf) {
    debugger;
    return 0;
  },

  fd_close(fd) {
    debugger;
    return 0;
  },
  proc_exit() {},

  fd_seek(fd, offset_bigint, whence, newOffset) {
    debugger;
  },
  fd_write(fd, iov, iovcnt, pnum) {
    debugger;
  },
};

var scratch: Uint8Array;
var scratch2: Uint8Array;

export class Bun {
  static has_initialized = false;
  static wasm_source: WebAssembly.WebAssemblyInstantiatedSource = null;
  static get wasm_exports(): WebAssemblyModule {
    return Bun.wasm_source.instance.exports as any;
  }
  static get memory(): WebAssembly.Memory {
    return Bun.wasm_source.instance.exports.memory as any;
  }

  static memory_array: Uint8Array;

  static _decoder: TextDecoder;

  static _wasmPtrToSlice(offset: number | bigint) {
    ptr_float[0] = typeof offset === "number" ? BigInt(offset) : offset;
    return new Uint8Array(Bun.memory.buffer, slice[0], slice[1]);
  }

  static _wasmPtrLenToString(slice: number) {
    if (!Bun._decoder) {
      Bun._decoder = new TextDecoder("utf8");
    }

    const region = this._wasmPtrToSlice(slice);
    return Bun._decoder.decode(region);
  }

  // We don't want people to be calling these manually
  static [wasm_imports_sym] = {
    console_log(slice: number) {
      console.log(Bun._wasmPtrLenToString(slice));
    },
    console_error(slice: number) {
      console.error(Bun._wasmPtrLenToString(slice));
    },
    console_warn(slice: number) {
      console.warn(Bun._wasmPtrLenToString(slice));
    },
    console_info(slice: number) {
      console.info(Bun._wasmPtrLenToString(slice));
    },

    __indirect_function_table: new WebAssembly.Table({
      initial: 0,
      element: "anyfunc",
    }),
    __stack_pointer: new WebAssembly.Global({
      mutable: true,
      value: "i32",
    }),
    __multi3(one: number, two: number) {
      return Math.imul(one | 0, two | 0);
    },
    fmod(one: number, two: number) {
      return one % two;
    },
    memset(ptr: number, value: number, len: number) {
      Bun.memory_array.fill(value, ptr, ptr + len);
    },
    memcpy(ptr: number, value: number, len: number) {
      Bun.memory_array.copyWithin(ptr, value, value + len);
    },
    // These functions convert a to an unsigned long long, rounding toward zero. Negative values all become zero.
    __fixunsdfti(a: number) {
      return Math.floor(a);
    },
    // These functions return the remainder of the unsigned division of a and b.
    __umodti3(a: number, b: number) {
      return (a | 0) % (b | 0);
    },
    // These functions return the quotient of the unsigned division of a and b.
    __udivti3(a: number, b: number) {
      return (a | 0) / (b | 0);
    },
    // These functions return the result of shifting a left by b bits.
    __ashlti3(a: number, b: number) {
      return (a | 0) >> (b | 0);
    },
    /* Returns: convert a to a double, rounding toward even. */
    __floatuntidf(a: number) {
      const mod = a % 2;
      if (mod === 0) {
        return Math.ceil(a);
      } else if (mod === 1) {
        return Math.floor(a);
      }
    },
    emscripten_notify_memory_growth() {},
  };

  static async init(url) {
    // globalThis.sucraseTransform = sucraseTransform;
    scratch = new Uint8Array(8096);

    if (Bun.has_initialized) {
      return;
    }

    Bun.wasm_source = await globalThis.WebAssembly.instantiateStreaming(
      fetch(url),
      { env: Bun[wasm_imports_sym], wasi_snapshot_preview1: Wasi },
    );

    const res = Bun.wasm_exports.init();
    if (res < 0) {
      throw `[Bun] Failed to initialize WASM module: code ${res}`;
    } else {
      console.log("WASM loaded.");
    }

    Bun.has_initialized = true;
  }

  static transformSync(content: Uint8Array | string, file_name: string) {
    if (!Bun.has_initialized) {
      throw "Please run await Bun.init(wasm_url) before using this.";
    }

    // if (process.env.NODE_ENV === "development") {
    //   console.time("[Bun] Transform " + file_name);
    // }

    const bb = new ByteBuffer(scratch);
    bb.length = 0;
    bb.index = 0;
    var contents_buffer;
    if (typeof content === "string") {
      if (!scratch2) {
        scratch2 = new Uint8Array(content.length * 2);
      }

      let i = 0;
      for (; i < content.length; i++) {
        if (i > scratch2.length) {
          var scratch3 = new Uint8Array(scratch2.length * 2);
          scratch3.set(scratch2);
          scratch2 = scratch3;
        }
        scratch2[i] = content.charCodeAt(i);
      }
      contents_buffer = scratch2.subarray(0, i);
    } else {
      contents_buffer = content;
    }

    Schema.encodeTransform(
      {
        contents: contents_buffer,
        path: file_name,
        loader: {
          ".jsx": Loader.jsx,
          ".tsx": Loader.tsx,
          ".ts": Loader.ts,
          ".js": Loader.js,
          ".json": Loader.json,
        }[path.extname(file_name)],
      },
      bb,
    );
    const data = bb.toUint8Array();

    const input_ptr = Bun.wasm_exports.bun_malloc(data.length);
    var buffer = this._wasmPtrToSlice(input_ptr);
    buffer.set(data);

    const resp_ptr = Bun.wasm_exports.transform(input_ptr);
    var _bb = new ByteBuffer(this._wasmPtrToSlice(resp_ptr));
    const response = Schema.decodeTransformResponse(_bb);
    Bun.wasm_exports.bun_free(input_ptr);
    scratch = bb.data;
    return response;
  }

  static scan(
    content: Uint8Array | string,
    file_name: string,
    loader?: Loader,
  ) {
    if (!Bun.has_initialized) {
      throw "Please run await Bun.init(wasm_url) before using this.";
    }

    // if (process.env.NODE_ENV === "development") {
    //   console.time("[Bun] Transform " + file_name);
    // }
    scratch.fill(0);
    const bb = new ByteBuffer(scratch);
    bb.length = 0;
    bb.index = 0;
    var contents_buffer;
    if (typeof content === "string") {
      if (!scratch2) {
        scratch2 = new Uint8Array(content.length * 2);
      }
      const encode_into = new TextEncoder().encodeInto(content, scratch2);
      contents_buffer = scratch2.subarray(0, encode_into.written);
    } else {
      contents_buffer = content;
    }

    Schema.encodeScan(
      {
        contents: contents_buffer,
        path: file_name,
        loader:
          loader ||
          {
            ".jsx": Loader.jsx,
            ".tsx": Loader.tsx,
            ".ts": Loader.ts,
            ".js": Loader.js,
            ".json": Loader.json,
          }[path.extname(file_name)],
      },
      bb,
    );
    const data = bb.toUint8Array();

    const input_ptr = Bun.wasm_exports.bun_malloc(data.length);
    var buffer = this._wasmPtrToSlice(input_ptr);
    buffer.set(data);

    const resp_ptr = Bun.wasm_exports.scan(input_ptr);
    var _bb = new ByteBuffer(this._wasmPtrToSlice(resp_ptr));
    const response = Schema.decodeScanResult(_bb);
    Bun.wasm_exports.bun_free(input_ptr);
    scratch = bb.data;
    return response;
  }
}

globalThis.Bun = Bun;
