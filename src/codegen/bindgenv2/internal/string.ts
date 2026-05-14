import assert from "node:assert";
import { CodeStyle, Type, toASCIILiteral } from "./base";

export const String = new (class extends Type {
  /** Converts to a string, as if by calling `String`. */
  get loose() {
    return LooseString;
  }

  get idlType() {
    return "::Bun::IDLStrictString";
  }
  get bindgenType() {
    return "bindgen.BindgenString";
  }
  rustType(style?: CodeStyle) {
    return "bun.string.WTFString";
  }
  optionalRustType(style?: CodeStyle) {
    return this.rustType(style) + ".Optional";
  }
  toCpp(value: string): string {
    assert(typeof value === "string");
    return toASCIILiteral(value);
  }
})();

export const LooseString = new (class extends Type {
  get idlType() {
    return "::Bun::IDLDOMString";
  }
  get bindgenType() {
    return String.bindgenType;
  }
  rustType(style?: CodeStyle) {
    return String.rustType(style);
  }
  optionalRustType(style?: CodeStyle) {
    return String.optionalRustType(style);
  }
  toCpp(value: string): string {
    return String.toCpp(value);
  }
})();
