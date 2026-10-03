import { type RustType, trivialRust, Type, unsupportedInRust } from "./base.ts";

export const RawAny = new (class extends Type {
  get idlType() {
    return "::Bun::IDLRawAny";
  }
  get rust() {
    return trivialRust("JSValue", 8);
  }
  toCpp(value: any): string {
    throw RangeError("`RawAny` cannot have a default value");
  }
})();

export const StrongAny = new (class extends Type {
  get idlType() {
    return "::Bun::Bindgen::IDLStrongAny";
  }
  get rust(): RustType {
    return unsupportedInRust("`StrongAny`");
  }
  toCpp(value: any): string {
    throw RangeError("`StrongAny` cannot have a default value");
  }
})();

export function isAny(type: Type): boolean {
  return type === RawAny || type === StrongAny;
}

export function hasRawAny(type: Type): boolean {
  return type === RawAny || type.dependencies.some(hasRawAny);
}
