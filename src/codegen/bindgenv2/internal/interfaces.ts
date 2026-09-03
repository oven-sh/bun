import { Type } from "./base";

export const ArrayBuffer = new (class extends Type {
  get idlType() {
    return `::Bun::IDLArrayBufferRef`;
  }
  toCpp(value: any): string {
    throw RangeError("default values for `ArrayBuffer` are not supported");
  }
})();

export const Blob = new (class extends Type {
  get idlType() {
    return `::Bun::IDLBlobRef`;
  }
  toCpp(value: any): string {
    throw RangeError("default values for `Blob` are not supported");
  }
  getHeaders(result: Set<string>): void {
    result.add("BunIDLConvertBlob.h");
  }
})();
