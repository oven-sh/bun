import * as Schema from "../../schema";
import { ByteBuffer } from "peechy";

export interface WebAssemblyModule {
  init(starting_memory: number): number;
  transform(a: number): number;
  malloc(a: number): number;
  calloc(a: number): number;
  realloc(a: number): number;
  free(a: number): number;
}

const wasm_imports_sym: symbol | string =
  process.env.NODE_ENV === "development"
    ? "wasm_imports"
    : Symbol("wasm_imports");

export class ESDev {
  static has_initialized = false;
  static wasm_source: WebAssembly.WebAssemblyInstantiatedSource = null;
  static get wasm_exports(): WebAssemblyModule {
    return ESDev.wasm_source.instance.exports as any;
  }
  static get memory() {
    return ESDev.wasm_exports.memory as WebAssembly.Memory;
  }
  static memory_array: Uint8Array;

  static _decoder: TextDecoder;

  static _wasmPtrLenToString(ptr: number, len: number) {
    if (!ESDev._decoder) {
      ESDev._decoder = new TextDecoder();
    }
    const region = ESDev.memory_array.subarray(ptr, ptr + len + 1);
    return ESDev._decoder.decode(region);
  }

  // We don't want people to be calling these manually
  static [wasm_imports_sym] = {
    console_log(ptr: number, len: number) {
      console.log(ESDev._wasmPtrLenToString(ptr, len));
    },
    console_error(ptr: number, len: number) {
      console.error(ESDev._wasmPtrLenToString(ptr, len));
    },
    console_warn(ptr: number, len: number) {
      console.warn(ESDev._wasmPtrLenToString(ptr, len));
    },
    console_info(ptr: number, len: number) {
      console.info(ESDev._wasmPtrLenToString(ptr, len));
    },
  };

  static async init(url) {
    ESDev.wasm_source = await globalThis.WebAssembly.instantiateStreaming(
      fetch(url),
      { env: ESDev[wasm_imports_sym] }
    );

    const res = ESDev.wasm_exports.init(1500);
    if (res < 0) {
      throw `[ESDev] Failed to initialize WASM module: code ${res}`;
    } else {
      console.log("WASM loaded.");
    }
    ESDev.memory_array = new Uint8Array(ESDev.memory.buffer);

    ESDev.has_initialized = true;
  }

  static transform(content: string, file_name: string) {
    if (!ESDev.has_initialized) {
      throw "Please run await ESDev.init(wasm_url) before using this.";
    }

    const bb = new ByteBuffer(
      new Uint8Array(content.length + file_name.length)
    );
    bb.length = 0;

    Schema.encodeTransform(
      {
        contents: content,
        path: file_name,
      },
      bb
    );
    const data = bb.toUint8Array();

    const ptr = ESDev.wasm_exports.malloc(data.byteLength);
    ESDev.memory_array.set(data, ptr);
    debugger;
    const resp_ptr = ESDev.wasm_exports.transform(ptr);
    var _bb = new ByteBuffer(ESDev.memory_array.subarray(resp_ptr));
    const response = Schema.decodeTransformResponse(_bb);
    ESDev.wasm_exports.free(resp_ptr);
    return response;
  }
}

globalThis.ESDev = ESDev;
