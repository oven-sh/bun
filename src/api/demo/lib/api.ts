import * as Schema from "../../schema";
import { ByteBuffer } from "peechy";

export interface WebAssemblyModule {
  init(): number;
  transform(a: number): number;
  malloc(a: number): number;
  calloc(a: number): number;
  realloc(a: number): number;
  free(a: number): number;
}

export class ESDev {
  static has_initialized = false;
  static wasm_source: WebAssembly.WebAssemblyInstantiatedSource = null;
  static wasm_exports: WebAssemblyModule;
  static memory: WebAssembly.Memory;
  static memory_array: Uint8Array;
  static async init(url) {
    if (typeof SharedArrayBuffer !== "undefined") {
      ESDev.memory = new WebAssembly.Memory({
        initial: 1500,
        maximum: 3000,
        shared: true,
      });
    } else {
      ESDev.memory = new WebAssembly.Memory({
        initial: 1500,
        maximum: 3000,
      });
    }
    ESDev.memory_array = new Uint8Array(ESDev.memory.buffer);
    ESDev.wasm_source = await globalThis.WebAssembly.instantiateStreaming(
      fetch(url),
      {
        js: {
          mem: ESDev.memory,
        },
      }
    );

    ESDev.wasm_exports = ESDev.wasm_source.instance.exports as any;
    ESDev.wasm_exports.init();
    console.log("WASM loaded.");
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
