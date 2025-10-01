import assert from "node:assert";
import { Type, toASCIILiteral } from "./base";

export const String: Type = new (class extends Type {
  get idlType() {
    return "::Bun::IDLStrictString";
  }
  get bindgenType() {
    return "bindgen.BindgenString";
  }
  zigType(style?) {
    return "bun.string.WTFString";
  }
  optionalZigType(style?) {
    return this.zigType(style) + ".Optional";
  }
  toCpp(value: string): string {
    assert(typeof value === "string");
    return toASCIILiteral(value);
  }
})();
