import { hasRawAny, isAny } from "./any";
import {
  addIndent,
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
import { Null, NullableType, OptionalType, Undefined } from "./optional";
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

export function Dictionary(
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
    zigType(style?) {
      return `bindgen_generated.${name}`;
    }
    get dependencies() {
      return fullMembers.map(m => m.type);
    }

    toCpp(value: DictionaryInstance): string {
      for (const memberName of Object.keys(members)) {
        if (!(memberName in value)) throw RangeError(`missing key: ${memberName}`);
      }
      for (const memberName of Object.keys(value)) {
        if (!(memberName in members)) throw RangeError(`unexpected key: ${memberName}`);
      }
      return reindent(`${name} {
        ${joinIndented(
          8,
          fullMembers.map(memberInfo => {
            const internalName = memberInfo.internalName;
            return `.${internalName} = ${memberInfo.type.toCpp(value[memberInfo.name])},`;
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
        struct FFI${name} {
          ${joinIndented(
            10,
            fullMembers.map((memberInfo, i) => {
              return `
                using MemberType${i} = FFITraits<${name}::MemberType${i}>::FFIType;
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
              FFI${name}* result);
          `);
          return addIndent(8, "\n" + result);
        })()}
        }

        template<> struct FFITraits<Generated::${name}> {
          using FFIType = Generated::FFI${name};
          static FFIType convertToFFI(Generated::${name}&& cppValue)
          {
            return FFIType {
              ${joinIndented(
                14,
                fullMembers.map((memberInfo, i) => {
                  const internalName = memberInfo.internalName;
                  const cppType = `Generated::${name}::MemberType${i}`;
                  const cppValue = `::std::move(cppValue.${internalName})`;
                  return `.${internalName} = FFITraits<${cppType}>::convertToFFI(${cppValue}),`;
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
              FFI${name}* result)
            {
              ::JSC::VM& vm = globalObject->vm();
              auto throwScope = DECLARE_THROW_SCOPE(vm);
              ${name} convertedValue = ::WebCore::convert<IDLDictionary<${name}>>(
                *globalObject,
                JSC::JSValue::decode(value)
              );
              RETURN_IF_EXCEPTION(throwScope, false);
              *result = FFITraits<${name}>::convertToFFI(::std::move(convertedValue));
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
                var ffi_result: FFI${name} = undefined;
                return if (bindgenConvertJSTo${name}(globalThis, value, &ffi_result))
                  Bindgen${name}.convertFromFFI(ffi_result)
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
          pub const FFIType = FFI${name};
          pub fn convertFromFFI(ffi_value: Self.FFIType) Self.ZigType {
            return .{
              ${joinIndented(
                14,
                fullMembers.map(memberInfo => {
                  const internalName = memberInfo.internalName;
                  const bindgenType = memberInfo.type.bindgenType;
                  const rhs = `${bindgenType}.convertFromFFI(ffi_value.${internalName})`;
                  return `.${internalName} = ${rhs},`;
                }),
              )}
            };
          }
        };

        const FFI${name} = extern struct {
          ${joinIndented(
            10,
            fullMembers.map(memberInfo => {
              return `${memberInfo.internalName}: ${memberInfo.type.bindgenType}.FFIType,`;
            }),
          )}
        };

        extern fn bindgenConvertJSTo${name}(
          globalObject: *jsc.JSGlobalObject,
          value: jsc.JSValue,
          result: *FFI${name},
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
    type instanceof OptionalType ||
    type instanceof NullableType ||
    type === Undefined ||
    type === Null ||
    isAny(type)
  );
}

function permitsUndefined(type: Type): boolean {
  if (isUnion(type)) {
    return type.dependencies.some(basicPermitsUndefined);
  }
  return basicPermitsUndefined(type);
}
