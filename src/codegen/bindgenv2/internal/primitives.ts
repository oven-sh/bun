import assert from "node:assert";
import util from "node:util";
import { CodeStyle, Type } from "./base";

export const bool = new (class extends Type {
  /** Converts to a boolean, as if by calling `Boolean`. */
  get loose() {
    return LooseBool;
  }

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

export const LooseBool = new (class extends Type {
  get idlType() {
    return "::WebCore::IDLBoolean";
  }
  get bindgenType() {
    return bool.bindgenType;
  }
  zigType(style?: CodeStyle) {
    return bool.zigType(style);
  }
  toCpp(value: boolean): string {
    return bool.toCpp(value);
  }
})();

export abstract class IntegerType extends Type {
  abstract loose: LooseIntegerType;
  abstract cppType: string;
}

function makeUnsignedType(width: number): IntegerType {
  assert(Number.isInteger(width) && width > 0);
  return new (class extends IntegerType {
    /** Converts to a number first. */
    get loose() {
      return looseUnsignedTypes[width];
    }

    get idlType() {
      return `::Bun::IDLStrictInteger<${this.cppType}>`;
    }
    get bindgenType() {
      return `bindgen.BindgenU${width}`;
    }
    zigType(style?: CodeStyle) {
      return `u${width}`;
    }
    get cppType() {
      return `::std::uint${width}_t`;
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

function makeSignedType(width: number): IntegerType {
  assert(Number.isInteger(width) && width > 0);
  return new (class extends IntegerType {
    /** Tries to convert to a number first. */
    get loose() {
      return looseSignedTypes[width];
    }

    get idlType() {
      return `::Bun::IDLStrictInteger<${this.cppType}>`;
    }
    get bindgenType() {
      return `bindgen.BindgenI${width}`;
    }
    zigType(style?: CodeStyle) {
      return `i${width}`;
    }
    get cppType() {
      return `::std::int${width}_t`;
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

export const u8: IntegerType = makeUnsignedType(8);
export const u16: IntegerType = makeUnsignedType(16);
export const u32: IntegerType = makeUnsignedType(32);
export const u64: IntegerType = makeUnsignedType(64);

export const i8: IntegerType = makeSignedType(8);
export const i16: IntegerType = makeSignedType(16);
export const i32: IntegerType = makeSignedType(32);
export const i64: IntegerType = makeSignedType(64);

export abstract class LooseIntegerType extends Type {}

function makeLooseIntegerType(strict: IntegerType): LooseIntegerType {
  return new (class extends LooseIntegerType {
    get idlType() {
      return `::Bun::IDLLooseInteger<${strict.cppType}>`;
    }
    get bindgenType() {
      return strict.bindgenType;
    }
    zigType(style?: CodeStyle) {
      return strict.zigType(style);
    }
    toCpp(value: number | bigint): string {
      return strict.toCpp(value);
    }
  })();
}

export const LooseU8: LooseIntegerType = makeLooseIntegerType(u8);
export const LooseU16: LooseIntegerType = makeLooseIntegerType(u16);
export const LooseU32: LooseIntegerType = makeLooseIntegerType(u32);
export const LooseU64: LooseIntegerType = makeLooseIntegerType(u64);

export const LooseI8: LooseIntegerType = makeLooseIntegerType(i8);
export const LooseI16: LooseIntegerType = makeLooseIntegerType(i16);
export const LooseI32: LooseIntegerType = makeLooseIntegerType(i32);
export const LooseI64: LooseIntegerType = makeLooseIntegerType(i64);

const looseUnsignedTypes: { [width: number]: LooseIntegerType } = {
  8: LooseU8,
  16: LooseU16,
  32: LooseU32,
  64: LooseU64,
};

const looseSignedTypes: { [width: number]: LooseIntegerType } = {
  8: LooseI8,
  16: LooseI16,
  32: LooseI32,
  64: LooseI64,
};

export const f64 = new (class extends Type {
  /** Does not allow NaN or infinities. */
  get finite() {
    return FiniteF64;
  }
  /** Converts to a number, as if by calling `Number`. */
  get loose() {
    return LooseF64;
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

export const FiniteF64 = new (class extends Type {
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

export const LooseF64 = new (class extends Type {
  get idlType() {
    return "::WebCore::IDLUnrestrictedDouble";
  }
  get bindgenType() {
    return f64.bindgenType;
  }
  zigType(style?: CodeStyle) {
    return f64.zigType(style);
  }
  toCpp(value: number): string {
    return f64.toCpp(value);
  }
})();
