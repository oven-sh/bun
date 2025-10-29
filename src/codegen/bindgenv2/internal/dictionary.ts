import { hasRawAny, isAny } from "./any";
import {
  addIndent,
  CodeStyle,
  dedent,
  headersForTypes,
  joinIndented,
  NamedType,
  reindent,
  toASCIILiteral,
  toQuotedLiteral,
  Type,
  validateName,
} from "./base";
import * as optional from "./optional";
import { isUnion } from "./union";

export interface DictionaryMember {
  type: Type;
  /** Optional default value to use when this member is missing or undefined. */
  default?: any;
  /** The name used in generated Zig/C++ code. Defaults to the public JS name. */
  internalName?: string;
  /** Alternative JavaScript names for this member. */
  altNames?: string[];
}

export interface DictionaryMembers {
  readonly [name: string]: Type | DictionaryMember;
}

export interface DictionaryInstance {
  readonly [name: string]: any;
}

export abstract class DictionaryType extends NamedType {}

interface DictionaryOptions {
  name: string;
  /** Used in error messages. Defaults to `name`. */
  userFacingName?: string;
  /** Whether to generate a Zig `fromJS` function. */
  generateConversionFunction?: boolean;
}

export function dictionary(
  nameOrOptions: string | DictionaryOptions,
  members: DictionaryMembers,
): DictionaryType {
  let name: string;
  let userFacingName: string;
  let generateConversionFunction = false;
  if (typeof nameOrOptions === "string") {
    name = nameOrOptions;
    userFacingName = name;
  } else {
    name = nameOrOptions.name;
    userFacingName = nameOrOptions.userFacingName ?? name;
    generateConversionFunction = !!nameOrOptions.generateConversionFunction;
  }
  validateName(name);
  const fullMembers = Object.entries(members).map(
    ([name, value]) => new FullDictionaryMember(name, value),
  );

  return new (class extends DictionaryType {
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
    get dependencies() {
      return fullMembers.map(m => m.type);
    }

    toCpp(value: DictionaryInstance): string {
      for (const memberName of Object.keys(value)) {
        if (!(memberName in members)) throw RangeError(`unexpected key: ${memberName}`);
      }
      return reindent(`${name} {
        ${joinIndented(
          8,
          fullMembers.map(memberInfo => {
            let memberValue;
            if (Object.hasOwn(value, memberInfo.name)) {
              memberValue = value[memberInfo.name];
            } else if (memberInfo.hasDefault) {
              memberValue = memberInfo.default;
            } else if (!permitsUndefined(memberInfo.type)) {
              throw RangeError(`missing key: ${memberInfo.name}`);
            }
            const internalName = memberInfo.internalName;
            return `.${internalName} = ${memberInfo.type.toCpp(memberValue)},`;
          }),
        )}
      }`);
    }

    get hasCppHeader() {
      return true;
    }
    get cppHeader() {
      return reindent(`
        #pragma once
        #include "Bindgen.h"
        #include "JSDOMConvertDictionary.h"
        ${headersForTypes(Object.values(fullMembers).map(m => m.type))
          .map(headerName => `#include <${headerName}>\n` + " ".repeat(8))
          .join("")}
        namespace Bun {
        namespace Bindgen {
        namespace Generated {
        struct ${name} {
          ${joinIndented(
            10,
            fullMembers.map((memberInfo, i) => {
              return `
                using MemberType${i} = ${memberInfo.type.idlType}::ImplementationType;
                MemberType${i} ${memberInfo.internalName};
              `;
            }),
          )}
        };
        using IDL${name} = ::WebCore::IDLDictionary<${name}>;
        struct Extern${name} {
          ${joinIndented(
            10,
            fullMembers.map((memberInfo, i) => {
              return `
                using MemberType${i} = ExternTraits<${name}::MemberType${i}>::ExternType;
                MemberType${i} ${memberInfo.internalName};
              `;
            }),
          )}
        };${(() => {
          if (!generateConversionFunction) {
            return "";
          }
          const result = dedent(`
            extern "C" bool bindgenConvertJSTo${name}(
              ::JSC::JSGlobalObject* globalObject,
              ::JSC::EncodedJSValue value,
              Extern${name}* result);
          `);
          return addIndent(8, "\n" + result);
        })()}
        }

        template<> struct ExternTraits<Generated::${name}> {
          using ExternType = Generated::Extern${name};
          static ExternType convertToExtern(Generated::${name}&& cppValue)
          {
            return ExternType {
              ${joinIndented(
                14,
                fullMembers.map((memberInfo, i) => {
                  const cppType = `Generated::${name}::MemberType${i}`;
                  const cppValue = `::std::move(cppValue.${memberInfo.internalName})`;
                  const rhs = `ExternTraits<${cppType}>::convertToExtern(${cppValue})`;
                  return `.${memberInfo.internalName} = ${rhs},`;
                }),
              )}
            };
          }
        };
        }

        template<>
        struct IDLHumanReadableName<::WebCore::IDLDictionary<Bindgen::Generated::${name}>>
          : BaseIDLHumanReadableName {
          static constexpr auto humanReadableName
            = ::std::to_array(${toQuotedLiteral(userFacingName)});
        };
        }

        template<> Bun::Bindgen::Generated::${name}
        WebCore::convertDictionary<Bun::Bindgen::Generated::${name}>(
          JSC::JSGlobalObject& globalObject,
          JSC::JSValue value);

        ${(() => {
          if (!hasRawAny(this)) {
            return "";
          }
          const code = `
            template<> struct WebCore::IDLDictionary<::Bun::Bindgen::Generated::${name}>
              : ::Bun::Bindgen::IDLStackOnlyDictionary<::Bun::Bindgen::Generated::${name}> {};
          `;
          return joinIndented(8, [code]);
        })()}
      `);
    }

    get hasCppSource() {
      return true;
    }
    get cppSource() {
      return reindent(`
        #include "root.h"
        #include "Generated${name}.h"
        #include "Bindgen/IDLConvert.h"
        #include <JavaScriptCore/Identifier.h>

        template<> Bun::Bindgen::Generated::${name}
        WebCore::convertDictionary<Bun::Bindgen::Generated::${name}>(
          JSC::JSGlobalObject& globalObject,
          JSC::JSValue value)
        {
          ::JSC::VM& vm = globalObject.vm();
          auto throwScope = DECLARE_THROW_SCOPE(vm);
          auto ctx = Bun::Bindgen::LiteralConversionContext { ${toASCIILiteral(userFacingName)} };
          auto* object = value.getObject();
          if (!object) [[unlikely]] {
            ctx.throwNotObject(globalObject, throwScope);
            return {};
          }
          ::Bun::Bindgen::Generated::${name} result;
          ${joinIndented(
            10,
            fullMembers.map((m, i) => memberConversion(userFacingName, m, i)),
          )}
          return result;
        }

        ${(() => {
          if (!generateConversionFunction) {
            return "";
          }
          const result = `
            namespace Bun::Bindgen::Generated {
            extern "C" bool bindgenConvertJSTo${name}(
              ::JSC::JSGlobalObject* globalObject,
              ::JSC::EncodedJSValue value,
              Extern${name}* result)
            {
              ::JSC::VM& vm = globalObject->vm();
              auto throwScope = DECLARE_THROW_SCOPE(vm);
              ${name} convertedValue = ::WebCore::convert<IDLDictionary<${name}>>(
                *globalObject,
                JSC::JSValue::decode(value)
              );
              RETURN_IF_EXCEPTION(throwScope, false);
              *result = ExternTraits<${name}>::convertToExtern(::std::move(convertedValue));
              return true;
            }
            }
          `;
          return joinIndented(8, [result]);
        })()}
      `);
    }

    get hasZigSource() {
      return true;
    }
    get zigSource() {
      return reindent(`
        pub const ${name} = struct {
          const Self = @This();

          ${joinIndented(
            10,
            fullMembers.map(memberInfo => {
              return `${memberInfo.internalName}: ${memberInfo.type.zigType("pretty")},`;
            }),
          )}

          pub fn deinit(self: *Self) void {
            ${joinIndented(
              12,
              fullMembers.map(memberInfo => {
                return `bun.memory.deinit(&self.${memberInfo.internalName});`;
              }),
            )}
            self.* = undefined;
          }${(() => {
            if (!generateConversionFunction) {
              return "";
            }
            const result = dedent(`
              pub fn fromJS(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!Self {
                var scope: jsc.ExceptionValidationScope = undefined;
                scope.init(globalThis, @src());
                defer scope.deinit();
                var extern_result: Extern${name} = undefined;
                const success = bindgenConvertJSTo${name}(globalThis, value, &extern_result);
                scope.assertExceptionPresenceMatches(!success);
                return if (success)
                  Bindgen${name}.convertFromExtern(extern_result)
                else
                  error.JSError;
              }
            `);
            return addIndent(10, "\n" + result);
          })()}
        };

        pub const Bindgen${name} = struct {
          const Self = @This();
          pub const ZigType = ${name};
          pub const ExternType = Extern${name};
          pub fn convertFromExtern(extern_value: Self.ExternType) Self.ZigType {
            return .{
              ${joinIndented(
                14,
                fullMembers.map(memberInfo => {
                  const internalName = memberInfo.internalName;
                  const bindgenType = memberInfo.type.bindgenType;
                  const rhs = `${bindgenType}.convertFromExtern(extern_value.${internalName})`;
                  return `.${internalName} = ${rhs},`;
                }),
              )}
            };
          }
        };

        const Extern${name} = extern struct {
          ${joinIndented(
            10,
            fullMembers.map(memberInfo => {
              return `${memberInfo.internalName}: ${memberInfo.type.bindgenType}.ExternType,`;
            }),
          )}
        };

        extern fn bindgenConvertJSTo${name}(
          globalObject: *jsc.JSGlobalObject,
          value: jsc.JSValue,
          result: *Extern${name},
        ) bool;

        const bindgen_generated = @import("bindgen_generated");
        const bun = @import("bun");
        const bindgen = bun.bun_js.bindgen;
        const jsc = bun.bun_js.jsc;
      `);
    }
  })();
}

class FullDictionaryMember {
  names: string[];
  internalName: string;
  type: Type;
  hasDefault: boolean = false;
  default?: any;

  constructor(name: string, member: Type | DictionaryMember) {
    if (member instanceof Type) {
      this.names = [name];
      this.internalName = name;
      this.type = member;
    } else {
      this.names = [name, ...(member.altNames ?? [])];
      this.internalName = member.internalName ?? name;
      this.type = member.type;
      this.hasDefault = Object.hasOwn(member, "default");
      this.default = member.default;
    }
  }

  get name(): string {
    return this.names[0];
  }
}

function memberConversion(
  userFacingDictName: string,
  memberInfo: FullDictionaryMember,
  memberIndex: number,
): string {
  const i = memberIndex;
  const internalName = memberInfo.internalName;
  const idlType = memberInfo.type.idlType;
  const qualifiedName = `${userFacingDictName}.${memberInfo.name}`;

  const start = `
    ::JSC::JSValue value${i};
    auto ctx${i} = Bun::Bindgen::LiteralConversionContext { ${toASCIILiteral(qualifiedName)} };
    do {
      ${joinIndented(
        6,
        memberInfo.names.map((memberName, altNameIndex) => {
          let result = "";
          if (altNameIndex > 0) {
            result = `if (!value${i}.isUndefined()) break;\n`;
          }
          result += dedent(`
            value${i} = object->get(
              &globalObject,
              ::JSC::Identifier::fromString(vm, ${toASCIILiteral(memberName)}));
            RETURN_IF_EXCEPTION(throwScope, {});
          `);
          return result;
        }),
      )}
    } while (false);
  `;

  let end: string;
  if (memberInfo.hasDefault) {
    end = `
      if (value${i}.isUndefined()) {
        result.${internalName} = ${memberInfo.type.toCpp(memberInfo.default)};
      } else {
        result.${internalName} = Bun::convertIDL<${idlType}>(globalObject, value${i}, ctx${i});
        RETURN_IF_EXCEPTION(throwScope, {});
      }
    `;
  } else if (permitsUndefined(memberInfo.type)) {
    end = `
      result.${internalName} = Bun::convertIDL<${idlType}>(globalObject, value${i}, ctx${i});
      RETURN_IF_EXCEPTION(throwScope, {});
    `;
  } else {
    end = `
      if (value${i}.isUndefined()) {
        ctx${i}.throwRequired(globalObject, throwScope);
        return {};
      }
      result.${internalName} = Bun::convertIDL<${idlType}>(globalObject, value${i}, ctx${i});
      RETURN_IF_EXCEPTION(throwScope, {});
    `;
  }
  const body = dedent(start) + "\n" + dedent(end);
  return addIndent(2, "{\n" + body) + "\n}";
}

function basicPermitsUndefined(type: Type): boolean {
  return (
    type instanceof optional.OptionalType ||
    type instanceof optional.NullableType ||
    type instanceof optional.LooseNullableType ||
    type === optional.undefined ||
    type === optional.null ||
    isAny(type)
  );
}

function permitsUndefined(type: Type): boolean {
  if (isUnion(type)) {
    return type.dependencies.some(basicPermitsUndefined);
  }
  return basicPermitsUndefined(type);
}
