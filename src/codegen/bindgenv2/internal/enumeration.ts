import assert from "node:assert";
import util from "node:util";
import {
  CodeStyle,
  joinIndented,
  NamedType,
  reindent,
  toASCIILiteral,
  toQuotedLiteral,
} from "./base";

abstract class EnumType extends NamedType {}

/**
 * If `values[x]` is an array, all elements of that array will map to the same underlying integral
 * value (that is, `x`). Essentially, they become different spellings of the same enum value.
 */
export function enumeration(
  name: string,
  values: readonly (string | readonly string[])[],
): EnumType {
  const uniqueValues: string[] = values.map((v, i) => {
    if (!Array.isArray(v)) return v;
    if (v.length === 0) throw RangeError(`enum value cannot be empty (index ${i})`);
    return v[0];
  });
  if (uniqueValues.length === 0) {
    throw RangeError("enum cannot be empty: " + name);
  }

  const indexedValues = values
    .map(v => (Array.isArray(v) ? v : [v]))
    .flatMap((arr, i) => arr.map((v): [string, number] => [v, i]));
  const valueMap = new Map<string, number>();
  for (const [value, index] of indexedValues) {
    if (valueMap.size === valueMap.set(value, index).size) {
      throw RangeError(`duplicate enum value: ${util.inspect(value)}`);
    }
  }

  const cppMemberSet = new Set<string>();
  for (const value of uniqueValues) {
    let cppName = "k";
    cppName += value
      .split(/[^A-Za-z0-9]+/)
      .filter(x => x)
      .map(s => s[0].toUpperCase() + s.slice(1))
      .join("");
    if (cppMemberSet.size === cppMemberSet.add(cppName).size) {
      let i = 2;
      while (cppMemberSet.size === cppMemberSet.add(cppName + i).size) {
        ++i;
      }
    }
  }
  const cppMembers = Array.from(cppMemberSet);
  return new (class extends EnumType {
    get name() {
      return name;
    }
    get idlType() {
      return `::Bun::Bindgen::Generated::IDL${name}`;
    }
    get bindgenType() {
      return `bindgen_generated.internal.${name}`;
    }
    zigType(style?: CodeStyle) {
      return `bindgen_generated.${name}`;
    }
    toCpp(value: string): string {
      const index = valueMap.get(value);
      if (index == null) {
        throw RangeError(`not a member of ${name}: ${util.inspect(value)}`);
      }
      return `::Bun::Bindgen::Generated::${name}::${cppMembers[index]}`;
    }

    get hasCppHeader() {
      return true;
    }
    get cppHeader() {
      const quotedValues = uniqueValues.map(v => `"${v}"`);
      let humanReadableName;
      if (quotedValues.length == 0) {
        assert(false); // unreachable
      } else if (quotedValues.length == 1) {
        humanReadableName = quotedValues[0];
      } else if (quotedValues.length == 2) {
        humanReadableName = quotedValues[0] + " or " + quotedValues[1];
      } else {
        humanReadableName =
          quotedValues.slice(0, -1).join(", ") + ", or " + quotedValues[quotedValues.length - 1];
      }

      return reindent(`
        #pragma once
        #include "Bindgen/ExternTraits.h"
        #include "JSDOMConvertEnumeration.h"

        namespace Bun {
        namespace Bindgen {
        namespace Generated {
        enum class ${name} : ::std::uint32_t {
          ${joinIndented(
            10,
            cppMembers.map(memberName => `${memberName},`),
          )}
        };
        using IDL${name} = ::WebCore::IDLEnumeration<Generated::${name}>;
        }
        template<> struct ExternTraits<Generated::${name}> : TrivialExtern<Generated::${name}> {};
        }
        template<>
        struct IDLHumanReadableName<::WebCore::IDLEnumeration<Bindgen::Generated::${name}>>
          : BaseIDLHumanReadableName {
          static constexpr auto humanReadableName
            = std::to_array(${toQuotedLiteral(humanReadableName)});
        };
        }

        template<> std::optional<Bun::Bindgen::Generated::${name}>
        WebCore::parseEnumerationFromString<Bun::Bindgen::Generated::${name}>(
          const WTF::String&);

        template<> std::optional<Bun::Bindgen::Generated::${name}>
        WebCore::parseEnumeration<Bun::Bindgen::Generated::${name}>(
          JSC::JSGlobalObject& globalObject,
          JSC::JSValue value);
      `);
    }

    get hasCppSource() {
      return true;
    }
    get cppSource() {
      const qualifiedName = "Bun::Bindgen::Generated::" + name;
      const pairType = `::std::pair<::WTF::ComparableASCIILiteral, ::${qualifiedName}>`;
      return reindent(`
        #include "root.h"
        #include "Generated${name}.h"
        #include <wtf/SortedArrayMap.h>

        template<> std::optional<${qualifiedName}>
        WebCore::parseEnumerationFromString<${qualifiedName}>(const WTF::String& stringVal)
        {
          static constexpr ::WTF::SortedArrayMap enumerationMapping { ::std::to_array<${pairType}>({
            ${joinIndented(
              12,
              Array.from(valueMap.entries())
                .sort(([v1], [v2]) => (v1 < v2 ? -1 : 1))
                .map(([value, i]) => {
                  return `${pairType} {
                    ${toASCIILiteral(value)},
                    ::${qualifiedName}::${cppMembers[i]},
                  },`;
                }),
            )}
          }) };
          if (auto* enumerationValue = enumerationMapping.tryGet(stringVal)) [[likely]] {
            return *enumerationValue;
          }
          return std::nullopt;
        }

        template<> std::optional<${qualifiedName}>
        WebCore::parseEnumeration<${qualifiedName}>(
          JSC::JSGlobalObject& globalObject,
          JSC::JSValue value)
        {
          return parseEnumerationFromString<::${qualifiedName}>(
            value.toWTFString(&globalObject)
          );
        }
      `);
    }

    get hasZigSource() {
      return true;
    }
    get zigSource() {
      return reindent(`
        pub const ${name} = enum(u32) {
          ${joinIndented(
            10,
            uniqueValues.map(value => `@${toQuotedLiteral(value)},`),
          )}
        };

        pub const Bindgen${name} = bindgen.BindgenTrivial(${name});
        const bun = @import("bun");
        const bindgen = bun.bun_js.bindgen;
      `);
    }
  })();
}
