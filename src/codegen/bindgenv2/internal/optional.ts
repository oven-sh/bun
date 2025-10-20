import { isAny } from "./any";
import { CodeStyle, Type } from "./base";

function bindgenOptional(payload: Type): string {
  return `bindgen.BindgenOptional(${payload.bindgenType})`;
}

export abstract class OptionalType extends Type {}

/** Treats `undefined` as a not-provided value. */
export function optional(payload: Type): OptionalType {
  if (isAny(payload)) {
    throw RangeError("`Any` types are already optional");
  }
  return new (class extends OptionalType {
    get idlType() {
      return `::WebCore::IDLOptional<${payload.idlType}>`;
    }
    get bindgenType() {
      return bindgenOptional(payload);
    }
    zigType(style?: CodeStyle) {
      return payload.optionalZigType(style);
    }
    toCpp(value: any): string {
      if (value === undefined) {
        return `::WebCore::IDLOptional<${payload.idlType}>::nullValue()`;
      }
      return payload.toCpp(value);
    }
  })();
}

export abstract class NullableType extends Type {
  abstract loose: LooseNullableType;
}

/** Treats `null` or `undefined` as a not-provided value. */
export function nullable(payload: Type): NullableType {
  return new (class extends NullableType {
    /** Treats all falsy values as null. */
    get loose() {
      return looseNullable(payload);
    }

    get idlType() {
      return `::WebCore::IDLNullable<${payload.idlType}>`;
    }
    get bindgenType() {
      return bindgenOptional(payload);
    }
    zigType(style?: CodeStyle) {
      return payload.optionalZigType(style);
    }
    toCpp(value: any): string {
      if (value == null) {
        return `::WebCore::IDLNullable<${payload.idlType}>::nullValue()`;
      }
      return payload.toCpp(value);
    }
  })();
}

export abstract class LooseNullableType extends Type {}

/** Treats all falsy values as null. */
export function looseNullable(payload: Type): LooseNullableType {
  return new (class extends LooseNullableType {
    get idlType() {
      return `::Bun::IDLLooseNullable<${payload.idlType}>`;
    }
    get bindgenType() {
      return bindgenOptional(payload);
    }
    zigType(style?: CodeStyle) {
      return payload.optionalZigType(style);
    }
    toCpp(value: any): string {
      if (!value) {
        return `::Bun::IDLLooseNullable<${payload.idlType}>::nullValue()`;
      }
      return payload.toCpp(value);
    }
  })();
}

/** For use in unions, to represent an optional union. */
const Undefined = new (class extends Type {
  get idlType() {
    return `::Bun::IDLStrictUndefined`;
  }
  get bindgenType() {
    return `bindgen.BindgenNull`;
  }
  zigType(style?: CodeStyle) {
    return "void";
  }
  toCpp(value: undefined): string {
    return `{}`;
  }
})();

/** For use in unions, to represent a nullable union. */
const Null = new (class extends Type {
  get idlType() {
    return `::Bun::IDLStrictNull`;
  }
  get bindgenType() {
    return `bindgen.BindgenNull`;
  }
  zigType(style?: CodeStyle) {
    return "void";
  }
  toCpp(value: null): string {
    return `nullptr`;
  }
})();

export { Null as null, Undefined as undefined };
