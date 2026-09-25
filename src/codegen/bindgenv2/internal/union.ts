import assert from "node:assert";
import {
  borrowed,
  headersForTypes,
  joinIndented,
  NamedType,
  pascalCase,
  reindent,
  type RustArm,
  type RustLayout,
  type RustType,
  rustVariants,
  Type,
  unsupportedInRust,
  validateName,
  variantLayout,
} from "./base.ts";

export interface NamedAlternatives {
  readonly [name: string]: Type;
}

export interface UnionInstance {
  readonly type: Type;
  readonly value: any;
}

export abstract class AnonymousUnionType extends Type {}
export abstract class NamedUnionType extends NamedType {}

export function isUnion(type: Type): boolean {
  return type instanceof AnonymousUnionType || type instanceof NamedUnionType;
}

export function union(alternatives: Type[]): AnonymousUnionType;
export function union(name: string, alternatives: NamedAlternatives): NamedUnionType;

/**
 * The order of types in this union is significant. Each type is tried in order, and the first one
 * that successfully converts determines the active field in the corresponding native tagged union.
 *
 * This means that it is an error to specify `RawAny` or `StrongAny` as anything other than the
 * last alternative, as conversion to any subsequent types would never be attempted.
 */
export function union(
  alternativesOrName: Type[] | string,
  maybeNamedAlternatives?: NamedAlternatives,
): AnonymousUnionType | NamedUnionType {
  let alternatives: Type[];

  function toCpp(value: UnionInstance): string {
    assert(alternatives.includes(value.type));
    return `${value.type.idlType}::ImplementationType { ${value.type.toCpp(value.value)} }`;
  }

  function getUnionType() {
    return `::Bun::IDLOrderedUnion<${alternatives.map(a => a.idlType).join(", ")}>`;
  }

  function validateAlternatives(name?: string) {
    const suffix = name == null ? "" : `: ${name}`;
    if (alternatives.length === 0) {
      throw RangeError("union cannot be empty" + suffix);
    }
  }

  if (typeof alternativesOrName !== "string") {
    alternatives = alternativesOrName.slice();
    validateAlternatives();
    // anonymous union (neither union nor fields are named)
    return new (class extends AnonymousUnionType {
      get idlType() {
        return getUnionType();
      }
      get rust(): RustType {
        return unsupportedInRust("a union with no name");
      }
      get dependencies() {
        return Object.freeze(alternatives);
      }
      toCpp(value: UnionInstance): string {
        return toCpp(value);
      }
    })();
  }

  assert(maybeNamedAlternatives !== undefined);
  const namedAlternatives: NamedAlternatives = maybeNamedAlternatives;
  const name: string = alternativesOrName;
  validateName(name);
  alternatives = Object.values(namedAlternatives);
  validateAlternatives(name);
  // named union (both union and fields are named)
  return new (class extends NamedUnionType {
    get name() {
      return name;
    }
    get idlType() {
      return `::Bun::Bindgen::Generated::IDL${name}`;
    }
    get rust(): RustType {
      const { size, align } = variantLayout(alternatives.map(a => a.rust));
      return {
        extern: `Extern${name}`,
        size,
        align,
        member: name,
        fromExtern: e => `${name}::from_extern(${borrowed(size)}${e})`,
      };
    }
    get rustLayout(): RustLayout {
      const { size, align, tag } = variantLayout(alternatives.map(a => a.rust));
      return {
        cpp: `::Bun::Bindgen::ExternTraits<::Bun::Bindgen::Generated::${name}>::ExternType`,
        rust: `Extern${name}`,
        size,
        align,
        fields: [
          { cpp: "data", rust: "data", offset: 0 },
          { cpp: "tag", rust: "tag", offset: tag },
        ],
      };
    }
    get rustSource() {
      const arms = Object.entries(namedAlternatives).map(([key, alt], tag) => {
        const rust = alt.rust;
        const payload: RustArm | null =
          rust.arm === undefined ? { type: rust.member, fromExtern: rust.fromExtern } : rust.arm;
        return { variant: pascalCase(key), extern: rust.extern, payload, tag };
      });
      rustVariants(
        name,
        arms.map(arm => arm.variant),
      );
      const released = arms.filter(arm => arm.payload?.release);
      return reindent(`
        pub enum ${name} {
          ${joinIndented(
            10,
            arms.map(arm =>
              arm.payload ? `${arm.variant}(${arm.payload.type}),` : `${arm.variant},`,
            ),
          )}
        }

        #[repr(C)]
        #[derive(Clone, Copy)]
        union Extern${name}Data {
          ${joinIndented(
            10,
            arms.map(arm => `_${arm.tag}: ${arm.extern},`),
          )}
        }

        #[repr(C)]
        #[derive(Clone, Copy)]
        struct Extern${name} {
          data: Extern${name}Data,
          tag: u8,
        }

        impl ${name} {
          fn from_extern(ext: ${borrowed(this.rust.size)}Extern${name}) -> Self {
            // SAFETY: C++ wrote the arm that \`tag\` names.
            unsafe {
              match ext.tag {
                ${joinIndented(
                  16,
                  arms.map(arm => {
                    const value = arm.payload
                      ? `(${arm.payload.fromExtern(`ext.data._${arm.tag}`)})`
                      : "";
                    return `${arm.tag} => Self::${arm.variant}${value},`;
                  }),
                )}
                _ => unreachable!(),
              }
            }
          }
        }${
          released.length === 0
            ? ""
            : `

        impl Drop for ${name} {
          fn drop(&mut self) {
            match self {
              ${joinIndented(
                14,
                released.map(arm => `Self::${arm.variant}(v) => ${arm.payload!.release}(v),`),
              )}${released.length < arms.length ? "\n              _ => {}" : ""}
            }
          }
        }`
        }
      `);
    }
    get dependencies() {
      return Object.freeze(alternatives);
    }
    toCpp(value: UnionInstance): string {
      return toCpp(value);
    }

    get hasCppHeader() {
      return true;
    }
    get cppHeader() {
      return reindent(`
        #pragma once
        #include "Bindgen/IDLTypes.h"
        ${headersForTypes(alternatives)
          .map(headerName => `#include <${headerName}>\n` + " ".repeat(8))
          .join("")}
        namespace Bun::Bindgen::Generated {
        using IDL${name} = ${getUnionType()};
        using ${name} = IDL${name}::ImplementationType;
        }
      `);
    }
  })();
}
