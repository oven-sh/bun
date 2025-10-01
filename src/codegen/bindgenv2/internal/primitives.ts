import assert from "node:assert";
import util from "node:util";
import { Type } from "./base";

export const Bool: Type = new (class extends Type {
  get idlType() {
    return "::Bun::IDLStrictBoolean";
  }
  get bindgenType() {
    return `bindgen.BindgenBool`;
  }
  zigType(style?) {
    return "bool";
  }
  toCpp(value: boolean): string {
    assert(typeof value === "boolean");
    return value ? "true" : "false";
  }
})();

function makeUnsignedType(width: number): Type {
  assert(Number.isInteger(width) && width > 0);
  return new (class extends Type {
    get idlType() {
      return `::Bun::IDLStrictInteger<std::uint${width}_t>`;
    }
    get bindgenType() {
      return `bindgen.BindgenU${width}`;
    }
    zigType(style?) {
      return `u${width}`;
    }
    toCpp(value: number | bigint): string {
      assert(["number", "bigint"].includes(typeof value));
      const intValue = BigInt(value);
      if (intValue < 0) throw RangeError("unsigned int cannot be negative");
      const max = 1n << BigInt(width);
      if (intValue >= max) throw RangeError("integer out of range");
      return intValue.toString();
    }
  })();
}

function makeSignedType(width: number): Type {
  assert(Number.isInteger(width) && width > 0);
  return new (class extends Type {
    get idlType() {
      return `::Bun::IDLStrictInteger<std::int${width}_t>`;
    }
    get bindgenType() {
      return `bindgen.BindgenI${width}`;
    }
    zigType(style?) {
      return `i${width}`;
    }
    toCpp(value: number | bigint): string {
      assert(["number", "bigint"].includes(typeof value));
      const intValue = BigInt(value);
      const max = 1n << BigInt(width - 1);
      const min = -max;
      if (intValue >= max || intValue < min) {
        throw RangeError("integer out of range");
      }
      return intValue.toString();
    }
  })();
}

export const Uint8: Type = makeUnsignedType(8);
export const Uint16: Type = makeUnsignedType(16);
export const Uint32: Type = makeUnsignedType(32);
export const Uint64: Type = makeUnsignedType(64);

export const Int8: Type = makeSignedType(8);
export const Int16: Type = makeSignedType(16);
export const Int32: Type = makeSignedType(32);
export const Int64: Type = makeSignedType(64);

export const Float: Type = new (class extends Type {
  get idlType() {
    return "::Bun::IDLStrictDouble";
  }
  get bindgenType() {
    return `bindgen.BindgenF64`;
  }
  zigType(style?) {
    return `f64`;
  }
  toCpp(value: number): string {
    assert(typeof value === "number");
    if (!Number.isFinite(value)) throw RangeError("number must be finite");
    return util.inspect(value);
  }
})();

export const FiniteFloat: Type = new (class extends Type {
  get idlType() {
    return "::Bun::IDLFiniteDouble";
  }
  get bindgenType() {
    return Float.bindgenType;
  }
  zigType(style?) {
    return Float.zigType(style);
  }
  toCpp(value: number): string {
    assert(typeof value === "number");
    if (Number.isNaN(value)) {
      return "::std::numeric_limits<double>::quiet_NaN()";
    } else if (value === Infinity) {
      return "::std::numeric_limits<double>::infinity()";
    } else if (value === -Infinity) {
      return "-::std::numeric_limits<double>::infinity()";
    } else {
      return util.inspect(value);
    }
  }
})();
