#include "EmbeddedCode.h"

#include "InternalModuleRegistryConstants.h"
#include <JavaScriptCore/JSCConfig.h>
#include <JavaScriptCore/Options.h>

extern "C" bool Bun__standaloneInternalModuleBytecode(void* bunVM, uint32_t id, const uint8_t** bytes, size_t* size, uint32_t* entryOffset);
extern "C" bool Bun__isEmbeddedModule(const uint8_t* source, size_t sourceLength, const uint8_t* bytecode, size_t bytecodeLength, size_t bytecodeEntryOffset);

namespace WebCore {
std::span<const Latin1Character> builtinsSource();
}

namespace Bun {

static bool isSame(std::span<const uint8_t> a, std::span<const uint8_t> b)
{
    return a.data() == b.data() && a.size() == b.size();
}

bool isEmbeddedCode(std::span<const uint8_t> source, std::span<const uint8_t> bytecode, size_t bytecodeEntryOffset)
{
    if (isSame(source, asByteSpan(WebCore::builtinsSource())))
        return bytecode.empty();

    std::span data { reinterpret_cast<const uint8_t*>(bun_internal_modules_data), bun_internal_modules_header.dataLength };
    if (source.data() < data.data() || source.data() >= data.data() + data.size())
        return Bun__isEmbeddedModule(source.data(), source.size(), bytecode.data(), bytecode.size(), bytecodeEntryOffset);

    auto* records = reinterpret_cast<const InternalModuleRegistryConstants::ModuleRecord*>(reinterpret_cast<const char*>(&bun_internal_modules_header) + bun_internal_modules_header.modulesOffset);
    for (uint32_t id = 0; id < bun_internal_modules_header.moduleCount; id++) {
        if (!isSame(source, data.subspan(records[id].codeOffset, records[id].codeLength)))
            continue;
        if (bytecode.empty())
            return true;
        const uint8_t* bytes = nullptr;
        size_t size = 0;
        uint32_t entryOffset = 0;
        return Bun__standaloneInternalModuleBytecode(nullptr, id, &bytes, &size, &entryOffset) && isSame(bytecode, { bytes, size }) && entryOffset == bytecodeEntryOffset;
    }
    return false;
}

} // namespace Bun

// After JSCInitialize and before the first VM, whose constructor freezes the options: nothing turns this off again.
extern "C" void JSC__runOnlyEmbeddedCode()
{
    RELEASE_ASSERT(!g_jscConfig.isPermanentlyFrozen());
    JSC::Options::refuseUntrustedCode() = true;
}

// Not Options::refuseUntrustedCode(), which asserts that JSC is set up: `bun build` asks for a macro before it is.
extern "C" bool JSC__runsOnlyEmbeddedCode()
{
    return g_jscConfig.options.refuseUntrustedCode;
}
