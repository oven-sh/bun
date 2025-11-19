#include "reprl.hpp"
#include "JavaScriptCore/Heap.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/InitializeThreading.h"
#include "JavaScriptCore/SourceCode.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "ZigGlobalObject.h"
#include "wtf/NakedPtr.h"
#include <span>

namespace bun::fuzzilli {

Reprl::Reprl() : m_vm(JSC::VM::create(JSC::HeapType::Large)) {
    JSC::JSLockHolder locker(m_vm.get());

    auto* structure = Zig::GlobalObject::createStructure(m_vm.get());
    if (!structure) {
        fprintf(stderr, "Failed to create global object structure\n");
        std::abort();
    }

    m_globalObject = Zig::GlobalObject::create(m_vm.get(), structure);
    if (!m_globalObject) {
        fprintf(stderr, "Failed to create global object\n");
        std::abort();
    }
}

Reprl::~Reprl() {
}

int Reprl::execute(std::string_view script) {
    JSC::JSLockHolder locker(m_vm.get());

    auto* globalObject = m_globalObject;

    // Create the source code
    auto sourceCode = JSC::SourceCode(
        JSC::StringSourceProvider::create(
            WTF::String::fromUTF8(std::span { script.data(), script.length() }),
            JSC::SourceOrigin(),
            WTF::String(),
            JSC::SourceTaintedOrigin::Untainted,
            WTF::TextPosition(),
            JSC::SourceProviderSourceType::Program
        )
    );

    // Evaluate the script
    WTF::NakedPtr<JSC::Exception> exception;
    JSC::evaluate(globalObject, sourceCode, JSC::JSValue(), exception);

    if (exception) {
        // Script threw an exception - return non-zero status
        return 1;
    }

    return 0;
}

void Reprl::reset() {
    JSC::JSLockHolder locker(m_vm.get());
    m_vm->heap.collectSync(JSC::CollectionScope::Full);
}

} // namespace bun::fuzzilli
