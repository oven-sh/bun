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

export function enumeration(name: string, values: string[]): EnumType {
  if (values.length === 0) {
    throw RangeError("enum cannot be empty: " + name);
  }
  if (values.length > 1n << 32n) {
    throw RangeError("too many enum values: " + name);
  }

  const valueSet = new Set<string>();
  const cppMemberSet = new Set<string>();
  for (const value of values) {
    if (valueSet.size === valueSet.add(value).size) {
      throw RangeError(`duplicate enum value in ${name}: ${util.inspect(value)}`);
    }
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
      const index = values.indexOf(value);
      if (index === -1) {
        throw RangeError(`not a member of this enumeration: ${value}`);
      }
      return `::Bun::Bindgen::Generated::${name}::${cppMembers[index]}`;
    }

    get hasCppHeader() {
      return true;
    }
    get cppHeader() {
      const quotedValues = values.map(v => `"${v}"`);
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
          static constexpr ::std::array<${pairType}, ${values.length}> mappings {
            ${joinIndented(
              12,
              values
                .map<[string, number]>((value, i) => [value, i])
                .sort()
                .map(([value, i]) => {
                  return `${pairType} {
                    ${toASCIILiteral(value)},
                    ::${qualifiedName}::${cppMembers[i]},
                  },`;
                }),
            )}
          };
          static constexpr ::WTF::SortedArrayMap enumerationMapping { mappings };
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
            values.map(value => `@${toQuotedLiteral(value)},`),
          )}
        };

        pub const Bindgen${name} = bindgen.BindgenTrivial(${name});
        const bun = @import("bun");
        const bindgen = bun.bun_js.bindgen;
      `);
    }
  })();
}
