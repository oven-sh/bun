import assert from "node:assert";
import { CodeStyle, Type, toASCIILiteral } from "./base";

export const String: Type = new (class extends Type {
  get idlType() {
    return "::Bun::IDLStrictString";
  }
  get bindgenType() {
    return "bindgen.BindgenString";
  }
  zigType(style?: CodeStyle) {
    return "bun.string.WTFString";
  }
  optionalZigType(style?: CodeStyle) {
    return this.zigType(style) + ".Optional";
  }
  toCpp(value: string): string {
    assert(typeof value === "string");
    return toASCIILiteral(value);
  }
})();
