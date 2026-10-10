import assert from "node:assert";
import { type RustType, Type, toASCIILiteral } from "./base.ts";

const pointer = { extern: "RawWTFStringImpl", size: 8, align: 8 };

export const String = new (class extends Type {
  /** Converts to a string, as if by calling `String`. */
  get loose() {
    return LooseString;
  }

  get idlType() {
    return "::Bun::IDLStrictString";
  }
  get rust(): RustType {
    return {
      ...pointer,
      member: "GenString",
      fromExtern: e => `adopt_string(${e})`,
      arm: { type: "GenVal<GenString>", fromExtern: e => `GenVal(adopt_string(${e}))` },
      optional: {
        ...pointer,
        member: "GenOpt<GenString>",
        fromExtern: e => `adopt_opt_string(${e})`,
      },
    };
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
  get rust() {
    return String.rust;
  }
  toCpp(value: string): string {
    return String.toCpp(value);
  }
})();
