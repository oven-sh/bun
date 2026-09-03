import assert from "node:assert";
import { Type, toASCIILiteral } from "./base";

export const String = new (class extends Type {
  /** Converts to a string, as if by calling `String`. */
  get loose() {
    return LooseString;
  }

  get idlType() {
    return "::Bun::IDLStrictString";
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
  toCpp(value: string): string {
    return String.toCpp(value);
  }
})();
