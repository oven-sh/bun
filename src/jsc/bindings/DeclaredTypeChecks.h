#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JSBuffer.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <wtf/text/MakeString.h>

// What the checks that src/codegen/declared-type-checks.ts writes are made of.
namespace Bun::DeclaredTypes {

ALWAYS_INLINE bool hasCellType(JSC::JSValue value, JSC::JSType type)
{
    return value.isCell() && value.asCell()->type() == type;
}

ALWAYS_INLINE bool isUnsharedArrayBuffer(JSC::JSValue value)
{
    return hasCellType(value, JSC::ArrayBufferType) && !uncheckedDowncast<JSC::JSArrayBuffer>(value)->isShared();
}

ALWAYS_INLINE bool isBuffer(JSC::JSValue value)
{
    return hasCellType(value, JSC::Uint8ArrayType) && JSBuffer__isBuffer(value.asCell()->structure()->globalObject(), JSC::JSValue::encode(value));
}

NEVER_INLINE inline void panicOnValueOutsideDeclaredType(JSC::VM& vm, const char* className, const char* member, const char* declaredType)
{
    // Nobody looks at the value that comes back beside an exception.
    if (vm.exceptionForInspection())
        return;
    auto message = makeString(ASCIILiteral::fromLiteralUnsafe(className), '.', ASCIILiteral::fromLiteralUnsafe(member), " is declared as "_s, ASCIILiteral::fromLiteralUnsafe(declaredType), ", but its value has another type"_s).utf8();
    auto bytes = byteCast<char>(message.span());
    Bun__panic(bytes.data(), bytes.size());
}

} // namespace Bun::DeclaredTypes
