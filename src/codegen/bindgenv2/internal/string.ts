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
  bunType(style?: CodeStyle) {
    return "bun.string.WTFString";
  }
  optionalBunType(style?: CodeStyle) {
    return this.bunType(style) + ".Optional";
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
  bunType(style?: CodeStyle) {
    return String.bunType(style);
  }
  optionalBunType(style?: CodeStyle) {
    return String.optionalBunType(style);
  }
  toCpp(value: string): string {
    return String.toCpp(value);
  }
})();
