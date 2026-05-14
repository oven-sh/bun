import { CodeStyle, Type } from "./base";

export const ArrayBuffer = new (class extends Type {
  get idlType() {
    return `::Bun::IDLArrayBufferRef`;
  }
  get bindgenType() {
    return `bindgen.BindgenArrayBuffer`;
  }
  rustType(style?: CodeStyle) {
    return "bun.bun_js.jsc.JSCArrayBuffer.Ref";
  }
  optionalRustType(style?: CodeStyle) {
    return this.rustType(style) + ".Optional";
  }
  toCpp(value: any): string {
    throw RangeError("default values for `ArrayBuffer` are not supported");
  }
})();

export const Blob = new (class extends Type {
  get idlType() {
    return `::Bun::IDLBlobRef`;
  }
  get bindgenType() {
    return `bindgen.BindgenBlob`;
  }
  rustType(style?: CodeStyle) {
    return "bun.bun_js.webcore.Blob.Ref";
  }
  optionalRustType(style?: CodeStyle) {
    return this.rustType(style) + ".Optional";
  }
  toCpp(value: any): string {
    throw RangeError("default values for `Blob` are not supported");
  }
  getHeaders(result: Set<string>): void {
    result.add("BunIDLConvertBlob.h");
  }
})();
