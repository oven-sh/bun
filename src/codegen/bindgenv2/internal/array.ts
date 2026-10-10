import { hasRawAny } from "./any.ts";
import { type RustType, Type } from "./base.ts";

export abstract class ArrayType extends Type {}

export function Array(elemType: Type): ArrayType {
  if (hasRawAny(elemType)) {
    throw RangeError("arrays cannot contain `RawAny` (use `StrongAny`)");
  }
  return new (class extends ArrayType {
    get idlType() {
      return `::Bun::IDLArray<${elemType.idlType}>`;
    }
    get rust(): RustType {
      const elem = elemType.rust;
      const convert = elem.fromExtern("v");
      const call = /^([\w:]+)\(v\)$/.exec(convert);
      return {
        extern: `ExternArrayList<${elem.extern}>`,
        size: 16,
        align: 8,
        member: `GenList<${elem.member}>`,
        fromExtern: e => `adopt_array(${e}, ${call ? call[1] : `|v| ${convert}`})`,
      };
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
