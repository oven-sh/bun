import * as Schema from "../../schema";
import { ByteBuffer } from "peechy/bb";
// import { transform as sucraseTransform } from "sucrase";

export interface WebAssemblyModule {
  init(): number;
  transform(a: number): number;
  malloc(a: number): number;
  calloc(a: number): number;
  realloc(a: number): number;
  free(a: number): number;
  cycle(): void;
}

const wasm_imports_sym: symbol | string =
  process.env.NODE_ENV === "development"
    ? "wasm_imports"
    : Symbol("wasm_imports");

const ptr_converter = new ArrayBuffer(8);
const ptr_float = new Float64Array(ptr_converter);
const slice = new Uint32Array(ptr_converter);

var scratch: Uint8Array;

export class ESDev {
  static has_initialized = false;
  static wasm_source: WebAssembly.WebAssemblyInstantiatedSource = null;
  static get wasm_exports(): WebAssemblyModule {
    return ESDev.wasm_source.instance.exports as any;
  }
  static get memory() {
    return ESDev[wasm_imports_sym].memory as WebAssembly.Memory;
  }

  static memory_array: Uint8Array;

  static _decoder: TextDecoder;

  static _wasmPtrToSlice(offset: number) {
    if (ESDev.memory_array.buffer !== ESDev.memory.buffer) {
      ESDev.memory_array = new Uint8Array(ESDev.memory.buffer);
    }
    ptr_float[0] = offset;
    return ESDev.memory_array.subarray(slice[0], slice[0] + slice[1]);
  }

  static _wasmPtrLenToString(slice: number) {
    if (!ESDev._decoder) {
      ESDev._decoder = new TextDecoder("utf8");
    }

    const region = this._wasmPtrToSlice(slice);

    return ESDev._decoder.decode(region);
  }

  // We don't want people to be calling these manually
  static [wasm_imports_sym] = {
    console_log(slice: number) {
      console.log(ESDev._wasmPtrLenToString(slice));
    },
    console_error(slice: number) {
      console.error(ESDev._wasmPtrLenToString(slice));
    },
    console_warn(slice: number) {
      console.warn(ESDev._wasmPtrLenToString(slice));
    },
    console_info(slice: number) {
      console.info(ESDev._wasmPtrLenToString(slice));
    },
    memory: null,
    // __indirect_function_table: new WebAssembly.Table({
    //   initial: 0,
    //   element: "anyfunc",
    // }),
    // __stack_pointer: new WebAssembly.Global({
    //   mutable: true,
    //   value: "i32",
    // }),
    // __multi3(one: number, two: number) {
    //   return Math.imul(one | 0, two | 0);
    // },
    // fmod(one: number, two: number) {
    //   return one % two;
    // },
    // memset(ptr: number, value: number, len: number) {
    //   ESDev.memory_array.fill(value, ptr, ptr + len);
    // },
    // memcpy(ptr: number, value: number, len: number) {
    //   ESDev.memory_array.copyWithin(ptr, value, value + len);
    // },
    // // These functions convert a to an unsigned long long, rounding toward zero. Negative values all become zero.
    // __fixunsdfti(a: number) {
    //   return Math.floor(a);
    // },
    // // These functions return the remainder of the unsigned division of a and b.
    // __umodti3(a: number, b: number) {
    //   return (a | 0) % (b | 0);
    // },
    // // These functions return the quotient of the unsigned division of a and b.
    // __udivti3(a: number, b: number) {
    //   return (a | 0) / (b | 0);
    // },
    // // These functions return the result of shifting a left by b bits.
    // __ashlti3(a: number, b: number) {
    //   return (a | 0) >> (b | 0);
    // },
    // /* Returns: convert a to a double, rounding toward even. */
    // __floatuntidf(a: number) {
    //   const mod = a % 2;
    //   if (mod === 0) {
    //     return Math.ceil(a);
    //   } else if (mod === 1) {
    //     return Math.floor(a);
    //   }
    // },
  };

  static async init(url) {
    // globalThis.sucraseTransform = sucraseTransform;
    scratch = new Uint8Array(8096);

    if (ESDev.has_initialized) {
      return;
    }

    ESDev[wasm_imports_sym].memory = new WebAssembly.Memory({
      initial: 20,
      // shared: typeof SharedArrayBuffer !== "undefined",
      maximum: typeof SharedArrayBuffer !== "undefined" ? 5000 : undefined,
    });

    ESDev.wasm_source = await globalThis.WebAssembly.instantiateStreaming(
      fetch(url),
      { env: ESDev[wasm_imports_sym] }
    );
    ESDev.memory_array = new Uint8Array(ESDev.memory.buffer);

    const res = ESDev.wasm_exports.init();
    if (res < 0) {
      throw `[ESDev] Failed to initialize WASM module: code ${res}`;
    } else {
      console.log("WASM loaded.");
    }

    ESDev.has_initialized = true;
  }

  static transform(content: Uint8Array, file_name: string) {
    if (!ESDev.has_initialized) {
      throw "Please run await ESDev.init(wasm_url) before using this.";
    }

    // if (process.env.NODE_ENV === "development") {
    //   console.time("[ESDev] Transform " + file_name);
    // }

    const bb = new ByteBuffer(scratch);
    bb.length = 0;

    Schema.encodeTransform(
      {
        contents: content,
        path: file_name,
      },
      bb
    );
    const data = bb.toUint8Array();
    if (bb._data.buffer !== scratch.buffer) {
      scratch = bb._data;
    }
    ESDev.wasm_exports.cycleStart();
    const ptr = ESDev.wasm_exports.malloc(data.byteLength);
    this._wasmPtrToSlice(ptr).set(data);
    const resp_ptr = ESDev.wasm_exports.transform(ptr);
    var _bb = new ByteBuffer(this._wasmPtrToSlice(resp_ptr));
    const response = Schema.decodeTransformResponse(_bb);
    ESDev.wasm_exports.cycleEnd();
    return response;
  }
}

globalThis.ESDev = ESDev;
