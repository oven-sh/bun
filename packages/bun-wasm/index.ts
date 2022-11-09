// @ts-nocheck
import { ByteBuffer } from "peechy/bb";
import {
  decodeScanResult,
  decodeTransformResponse,
  encodeScan,
  encodeTransform,
  Loader as BunLoader,
  type ScanResult,
  type TransformResponse,
} from "./schema";
export enum Loader {
  jsx = BunLoader.jsx,
  js = BunLoader.js,
  tsx = BunLoader.tsx,
  ts = BunLoader.ts,
}

export type { ScanResult, TransformResponse };

function normalizeLoader(file_name: string, loader?: Loader): BunLoader {
  return (
    (loader
      ? {
          jsx: BunLoader.jsx,
          tsx: BunLoader.tsx,
          ts: BunLoader.ts,
          js: BunLoader.js,
        }[loader]
      : null) ||
    {
      ".jsx": BunLoader.jsx,
      ".tsx": BunLoader.tsx,
      ".ts": BunLoader.ts,
      ".js": BunLoader.js,
    }[file_name.substring(file_name.lastIndexOf("."))] ||
    BunLoader.js
  );
}

interface WebAssemblyModule {
  init(): number;
  transform(a: number): number;
  bun_malloc(a: number): number;
  bun_free(a: number): number;
  scan(a: number): number;
}

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

const env = {
  console_log(slice: number) {
    //@ts-ignore
    console.log(Bun._wasmPtrLenToString(slice));
  },
  console_error(slice: number) {
    //@ts-ignore
    console.error(Bun._wasmPtrLenToString(slice));
  },
  console_warn(slice: number) {
    //@ts-ignore
    console.warn(Bun._wasmPtrLenToString(slice));
  },
  console_info(slice: number) {
    //@ts-ignore
    console.info(Bun._wasmPtrLenToString(slice));
  },
  // @ts-ignore-line
  __indirect_function_table: new WebAssembly.Table({
    initial: 0,
    element: "anyfunc",
  }),
  // @ts-ignore-line
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
    //@ts-ignore
    Bun.memory_array.fill(value, ptr, ptr + len);
  },
  memcpy(ptr: number, value: number, len: number) {
    //@ts-ignore
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

export class Bun {
  private static has_initialized = false;
  // @ts-ignore-line
  private static wasm_source: WebAssembly.WebAssemblyInstantiatedSource = null;
  private static get wasm_exports(): WebAssemblyModule {
    return Bun.wasm_source.instance.exports as any;
  }
  // @ts-ignore-line
  private static get memory(): WebAssembly.Memory {
    return Bun.wasm_source.instance.exports.memory as any;
  }

  private static memory_array: Uint8Array;

  private static _decoder: TextDecoder;

  private static _wasmPtrToSlice(offset: number | bigint) {
    ptr_float[0] = typeof offset === "number" ? BigInt(offset) : offset;
    return new Uint8Array(Bun.memory.buffer, slice[0], slice[1]);
  }

  private static _wasmPtrLenToString(slice: number) {
    if (!Bun._decoder) {
      Bun._decoder = new TextDecoder("utf8");
    }

    const region = Bun._wasmPtrToSlice(slice);
    return Bun._decoder.decode(region);
  }

  static async init(url, fetch = globalThis.fetch) {
    // globalThis.sucraseTransform = sucraseTransform;
    scratch = new Uint8Array(8096);

    if (Bun.has_initialized) {
      return;
    }

    if (globalThis?.WebAssembly?.instantiateStreaming) {
      Bun.wasm_source = await globalThis.WebAssembly.instantiateStreaming(
        fetch(url),
        { env: env, wasi_snapshot_preview1: Wasi },
      );
    } else if (typeof window !== "undefined") {
      const resp = await fetch(url);
      Bun.wasm_source = await globalThis.WebAssembly.instantiate(
        await resp.arrayBuffer(),
        {
          env: env,
          wasi_snapshot_preview1: Wasi,
        },
      );
      // is it node?
    } else {
      //@ts-ignore
      const fs = await import("fs");

      Bun.wasm_source = await globalThis.WebAssembly.instantiate(
        fs.readFileSync(url),
        {
          env: env,
          wasi_snapshot_preview1: Wasi,
        },
      );
    }

    const res = Bun.wasm_exports.init();
    if (res < 0) {
      throw `[Bun] Failed to initialize WASM module: code ${res}`;
    }

    Bun.has_initialized = true;
  }

  static transformSync(
    content: Uint8Array | string,
    file_name: string,
    loader?: Loader,
  ): TransformResponse {
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
    encodeTransform(
      {
        contents: contents_buffer,
        path: file_name,
        // @ts-ignore
        loader: normalizeLoader(file_name, loader),
      },
      bb,
    );
    const data = bb.toUint8Array();

    const input_ptr = Bun.wasm_exports.bun_malloc(data.length);
    var buffer = Bun._wasmPtrToSlice(input_ptr);
    buffer.set(data);

    const resp_ptr = Bun.wasm_exports.transform(input_ptr);

    var _bb = new ByteBuffer(Bun._wasmPtrToSlice(resp_ptr));

    const response = decodeTransformResponse(_bb);
    Bun.wasm_exports.bun_free(input_ptr);
    scratch = bb.data;
    return response;
  }

  static scan(
    content: Uint8Array | string,
    file_name: string,
    loader?: Loader,
  ): ScanResult {
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

    encodeScan(
      {
        contents: contents_buffer,
        path: file_name,
        // @ts-ignore
        loader: normalizeLoader(file_name, loader),
      },
      bb,
    );
    const data = bb.toUint8Array();

    const input_ptr = Bun.wasm_exports.bun_malloc(data.length);
    var buffer = Bun._wasmPtrToSlice(input_ptr);
    buffer.set(data);

    const resp_ptr = Bun.wasm_exports.scan(input_ptr);
    var _bb = new ByteBuffer(Bun._wasmPtrToSlice(resp_ptr));
    const response = decodeScanResult(_bb);
    Bun.wasm_exports.bun_free(input_ptr);
    scratch = bb.data;
    return response;
  }
}

export const transformSync = Bun.transformSync;
export const scan = Bun.scan;
export const init = Bun.init;
export default Bun;

if ("window" in globalThis && !("Bun" in globalThis)) {
  // @ts-ignore-line
  globalThis.Bun = Bun;
}

//@ts-ignore
if (process.env.NODE_ENV === "development") {
  //@ts-ignore
  Bun.env = env;
}
