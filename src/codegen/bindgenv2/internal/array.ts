import { hasRawAny } from "./any";
import { CodeStyle, Type } from "./base";

export abstract class ArrayType extends Type {}

export function Array(elemType: Type): ArrayType {
  if (hasRawAny(elemType)) {
    throw RangeError("arrays cannot contain `RawAny` (use `StrongAny`)");
  }
  return new (class extends ArrayType {
    get idlType() {
      return `::Bun::IDLArray<${elemType.idlType}>`;
    }
    get bindgenType() {
      return `bindgen.BindgenArray(${elemType.bindgenType})`;
    }
    zigType(style?: CodeStyle) {
      return `bun.collections.ArrayListDefault(${elemType.zigType(style)})`;
    }
    toCpp(value: any[]): string {
      const args = `${value.map(elem => elemType.toCpp(elem)).join(", ")}`;
      return `${this.idlType}::ImplementationType { ${args} }`;
    }
    get dependencies() {
      return [elemType];
    }
    getHeaders(result: Set<string>): void {
      result.add("Bindgen/ExternVectorTraits.h");
      elemType.getHeaders(result);
    }
  })();
}
