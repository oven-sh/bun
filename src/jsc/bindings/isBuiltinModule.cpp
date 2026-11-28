#include "root.h"

#include "isBuiltinModule.h"
#include "BuiltinModuleKeys.h"

extern "C" int ModuleLoader__builtinAliasIndex(const Latin1Character*, size_t);

static constexpr ASCIILiteral builtinModuleNamesOfBun[] = {
    "ws"_s,
    "bun"_s,
    "undici"_s,
    "bun:ffi"_s,
    "bun:jsc"_s,
    "bun:wrap"_s,
    "bun:test"_s,
    "bun:main"_s,
    "bun:sqlite"_s,
};

namespace Bun {

bool isBuiltinModule(const String& name)
{
    for (auto& builtinModule : builtinModuleNamesOfBun) {
        if (name == builtinModule)
            return true;
    }
    return !keyOfNodeBuiltin(name).isNull();
}

ASCIILiteral keyOfNodeBuiltin(const String& name)
{
    if (!name.is8Bit())
        return name.containsOnlyLatin1() ? keyOfNodeBuiltin(String::make8Bit(name.span16())) : ASCIILiteral();
    int index = ModuleLoader__builtinAliasIndex(name.span8().data(), name.length());
    return index >= 0 && StringView(builtinModuleKeys[index]).startsWith("node:"_s) ? builtinModuleKeys[index] : ASCIILiteral();
}

} // namespace Bun
