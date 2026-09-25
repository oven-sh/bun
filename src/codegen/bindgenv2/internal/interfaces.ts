import { type RustType, Type, unsupportedInRust } from "./base.ts";

/** A counted pointer. Only a union arm has an owner that releases it. */
function counted(name: string, extern: string, release: string): RustType {
  return {
    extern,
    size: 8,
    align: 8,
    get member(): string {
      return unsupportedInRust(`\`${name}\` outside of a union`);
    },
    fromExtern: e => e,
    arm: { type: `GenVal<${extern}>`, fromExtern: e => `GenVal(${e})`, release },
  };
}

export const ArrayBuffer = new (class extends Type {
  get idlType() {
    return `::Bun::IDLArrayBufferRef`;
  }
  get rust() {
    return counted("ArrayBuffer", "GenArrayBuffer", "release_gen_val_array_buffer");
  }
  toCpp(value: any): string {
    throw RangeError("default values for `ArrayBuffer` are not supported");
  }
})();

export const Blob = new (class extends Type {
  get idlType() {
    return `::Bun::IDLBlobRef`;
  }
  get rust() {
    return counted("Blob", "GenBlob", "release_gen_val_blob");
  }
  toCpp(value: any): string {
    throw RangeError("default values for `Blob` are not supported");
  }
  getHeaders(result: Set<string>): void {
    result.add("BunIDLConvertBlob.h");
  }
})();
