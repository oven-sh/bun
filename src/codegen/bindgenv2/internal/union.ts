import assert from "node:assert";
import {
  dedent,
  headersForTypes,
  joinIndented,
  NamedType,
  reindent,
  Type,
  validateName,
} from "./base";

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

export function Union(alternatives: Type[]): AnonymousUnionType;
export function Union(name: string, alternatives: NamedAlternatives): NamedUnionType;

/**
 * The order of types in this union is significant. Each type is tried in order, and the first one
 * that successfully converts determines the active field in the corresponding Zig tagged union.
 *
 * This means that it is an error to specify `RawAny` or `StrongAny` as anything other than the
 * last alternative, as conversion to any subsequent types would never be attempted.
 */
export function Union(
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

  function validateAlternatives() {
    if (alternatives.length === 0) {
      throw RangeError("union cannot be empty: " + name);
    }
  }

  if (typeof alternativesOrName !== "string") {
    alternatives = alternativesOrName;
    validateAlternatives();
    // anonymous union (neither union nor fields are named)
    return new (class extends AnonymousUnionType {
      get idlType() {
        return getUnionType();
      }
      get bindgenType() {
        return `bindgen.BindgenUnion(&.{ ${alternatives.map(a => a.bindgenType).join(", ")} })`;
      }
      zigType(style?) {
        if (style !== "pretty") {
          return `bun.meta.TaggedUnion(&.{ ${alternatives.map(a => a.zigType()).join(", ")} })`;
        }
        return dedent(`bun.meta.TaggedUnion(&.{
          ${joinIndented(
            10,
            alternatives.map(a => a.zigType("pretty") + ","),
          )}
        })`);
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
  validateAlternatives();
  // named union (both union and fields are named)
  return new (class extends NamedUnionType {
    get name() {
      return name;
    }
    get idlType() {
      return `::Bun::Bindgen::Generated::IDL${name}`;
    }
    get bindgenType() {
      return `bindgen_generated.internal.${name}`;
    }
    zigType(style?) {
      return `bindgen_generated.${name}`;
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

    get hasZigSource() {
      return true;
    }
    get zigSource() {
      return reindent(`
        pub const ${name} = union(enum) {
          ${joinIndented(
            10,
            Object.entries(namedAlternatives).map(([altName, altType]) => {
              return `${altName}: ${altType.zigType("pretty")},`;
            }),
          )}

          pub fn deinit(self: *@This()) void {
            switch (std.meta.activeTag(self.*)) {
              inline else => |tag| bun.memory.deinit(&@field(self, @tagName(tag))),
            }
            self.* = undefined;
          }
        };

        pub const Bindgen${name} = struct {
          const Self = @This();
          pub const ZigType = ${name};
          pub const FFIType = bindgen.FFITaggedUnion(&.{ ${alternatives
            .map(a => a.bindgenType + ".FFIType")
            .join(", ")} });
          pub const OptionalFFIType = FFIType;
          pub fn convertFromFFI(ffi_value: Self.FFIType) Self.ZigType {
            return switch (ffi_value.tag) {
              ${joinIndented(
                14,
                Object.entries(namedAlternatives).map(([altName, altType], i) => {
                  const innerRhs = `${altType.bindgenType}.convertFromFFI(ffi_value.data.@"${i}")`;
                  return `${i} => .{ .${altName} = ${innerRhs} },`;
                }),
              )}
              else => unreachable,
            };
          }
          pub fn convertOptionalFromFFI(ffi_value: Self.OptionalFFIType) ?Self.ZigType {
            return if (ffi_value.isNull()) null else Self.convertFromFFI(ffi_value);
          }
        };

        const bindgen_generated = @import("bindgen_generated");
        const std = @import("std");
        const bun = @import("bun");
        const bindgen = bun.bun_js.bindgen;
      `);
    }
  })();
}
