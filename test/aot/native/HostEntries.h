#pragma once

#include <JavaScriptCore/AOTBuiltinTable.h>
#include <JavaScriptCore/AOTNativeTest.h>

#if ENABLE(AOT)

namespace JSC { namespace AOT {

inline BuiltinID hostBuiltin(ASCIILiteral token)
{
    BuiltinID id = BuiltinTable::singleton().builtinFromToken(token);
    AOT_TEST_CHECK(id);
    return id;
}

inline BuiltinClassID hostClass(ASCIILiteral token)
{
    BuiltinClassID id = BuiltinTable::singleton().classFromToken(token);
    AOT_TEST_CHECK(id);
    return id;
}

inline RuntimeModuleID hostModule(ASCIILiteral token)
{
    RuntimeModuleID id = BuiltinTable::singleton().moduleFromToken(token);
    AOT_TEST_CHECK(id);
    return id;
}

inline BuiltinName hostName(ASCIILiteral text)
{
    BuiltinName name = BuiltinTable::singleton().nameOf(byteCast<uint8_t>(text.span()));
    AOT_TEST_CHECK(name);
    return name;
}

} } // namespace JSC::AOT

#endif // ENABLE(AOT)
