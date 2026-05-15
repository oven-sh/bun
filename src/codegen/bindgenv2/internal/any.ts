import { CodeStyle, Type } from "./base";

export const RawAny = new (class extends Type {
  get idlType() {
    return "::Bun::IDLRawAny";
  }
  get bindgenType() {
    return "bindgen.BindgenRawAny";
  }
  bunType(style?: CodeStyle) {
    return "bun.bun_js.jsc.JSValue";
  }
  toCpp(value: any): string {
    throw RangeError("`RawAny` cannot have a default value");
  }
})();

export const StrongAny = new (class extends Type {
  get idlType() {
    return "::Bun::Bindgen::IDLStrongAny";
  }
  get bindgenType() {
    return "bindgen.BindgenStrongAny";
  }
  bunType(style?: CodeStyle) {
    return "bun.bun_js.jsc.Strong";
  }
  optionalBunType(style?: CodeStyle) {
    return this.bunType(style) + ".Optional";
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
