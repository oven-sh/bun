import assert from "node:assert";
import util from "node:util";
import { CodeStyle, Type } from "./base";

export const bool: Type = new (class extends Type {
  get idlType() {
    return "::Bun::IDLStrictBoolean";
  }
  get bindgenType() {
    return `bindgen.BindgenBool`;
  }
  zigType(style?: CodeStyle) {
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
      return `::Bun::IDLStrictInteger<::std::uint${width}_t>`;
    }
    get bindgenType() {
      return `bindgen.BindgenU${width}`;
    }
    zigType(style?: CodeStyle) {
      return `u${width}`;
    }
    toCpp(value: number | bigint): string {
      assert(typeof value === "bigint" || Number.isSafeInteger(value));
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
      return `::Bun::IDLStrictInteger<::std::int${width}_t>`;
    }
    get bindgenType() {
      return `bindgen.BindgenI${width}`;
    }
    zigType(style?: CodeStyle) {
      return `i${width}`;
    }
    toCpp(value: number | bigint): string {
      assert(typeof value === "bigint" || Number.isSafeInteger(value));
      const intValue = BigInt(value);
      const max = 1n << BigInt(width - 1);
      const min = -max;
      if (intValue >= max || intValue < min) {
        throw RangeError("integer out of range");
      }
      if (width === 64 && intValue === min) {
        return `(${intValue + 1n} - 1)`;
      }
      return intValue.toString();
    }
  })();
}

export const u8: Type = makeUnsignedType(8);
export const u16: Type = makeUnsignedType(16);
export const u32: Type = makeUnsignedType(32);
export const u64: Type = makeUnsignedType(64);

export const i8: Type = makeSignedType(8);
export const i16: Type = makeSignedType(16);
export const i32: Type = makeSignedType(32);
export const i64: Type = makeSignedType(64);

export const f64: Type = new (class extends Type {
  get finite() {
    return finiteF64;
  }

  get idlType() {
    return "::Bun::IDLStrictDouble";
  }
  get bindgenType() {
    return `bindgen.BindgenF64`;
  }
  zigType(style?: CodeStyle) {
    return `f64`;
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

export const finiteF64: Type = new (class extends Type {
  get idlType() {
    return "::Bun::IDLFiniteDouble";
  }
  get bindgenType() {
    return f64.bindgenType;
  }
  zigType(style?: CodeStyle) {
    return f64.zigType(style);
  }
  toCpp(value: number): string {
    assert(typeof value === "number");
    if (!Number.isFinite(value)) throw RangeError("number must be finite");
    return util.inspect(value);
  }
})();
