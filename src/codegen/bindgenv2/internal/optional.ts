import { isAny } from "./any";
import { Type } from "./base";

export abstract class OptionalType extends Type {}

export function Optional(payload: Type): OptionalType {
  if (isAny(payload)) {
    throw RangeError("`Any` types are already optional");
  }
  return new (class extends OptionalType {
    get idlType() {
      return `::WebCore::IDLOptional<${payload.idlType}>`;
    }
    get bindgenType() {
      return `bindgen.BindgenOptional(${payload.bindgenType})`;
    }
    zigType(style?) {
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

export abstract class NullableType extends Type {}

export function Nullable(payload: Type): NullableType {
  const AsOptional = Optional(payload);
  return new (class extends NullableType {
    get idlType() {
      return `::WebCore::IDLNullable<${payload.idlType}>`;
    }
    get bindgenType() {
      return AsOptional.bindgenType;
    }
    zigType(style?) {
      return AsOptional.zigType(style);
    }
    toCpp(value: any): string {
      if (value == null) {
        return `::WebCore::IDLNullable<${payload.idlType}>::nullValue()`;
      }
      return payload.toCpp(value);
    }
  })();
}

/** For use in unions, to represent an optional union. */
export const Undefined = new (class extends Type {
  get idlType() {
    return `::Bun::IDLStrictUndefined`;
  }
  get bindgenType() {
    return `bindgen.BindgenNull`;
  }
  zigType(style?) {
    return "void";
  }
  toCpp(value: undefined): string {
    return `{}`;
  }
})();

/** For use in unions, to represent a nullable union. */
export const Null = new (class extends Type {
  get idlType() {
    return `::Bun::IDLStrictNull`;
  }
  get bindgenType() {
    return `bindgen.BindgenNull`;
  }
  zigType(style?) {
    return "void";
  }
  toCpp(value: null): string {
    return `nullptr`;
  }
})();
