#include "reprl.hpp"
#include "JavaScriptCore/Heap.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/InitializeThreading.h"
#include "JavaScriptCore/SourceCode.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "wtf/NakedPtr.h"
#include <span>

namespace bun::fuzzilli {

Reprl::Reprl() : m_vm(JSC::VM::create(JSC::HeapType::Large)) {
    fprintf(stderr, "[Fuzzilli] Reprl() constructor started\n");
    fprintf(stderr, "[Fuzzilli] VM created\n");

    // Acquire heap access before creating the global object
    fprintf(stderr, "[Fuzzilli] About to acquire heap access\n");
    m_vm->heap.acquireAccess();
    fprintf(stderr, "[Fuzzilli] Heap access acquired\n");

    fprintf(stderr, "[Fuzzilli] About to acquire JS lock\n");
    JSC::JSLockHolder locker(m_vm.get());
    fprintf(stderr, "[Fuzzilli] JS lock acquired\n");

    // Use vanilla JSC::JSGlobalObject instead of Zig::GlobalObject
    // This avoids needing the full Bun VirtualMachine infrastructure
    fprintf(stderr, "[Fuzzilli] About to create global object structure\n");
    auto* structure = JSC::JSGlobalObject::createStructure(m_vm.get(), JSC::jsNull());
    if (!structure) {
        fprintf(stderr, "[Fuzzilli] ERROR: Failed to create global object structure\n");
        std::abort();
    }
    fprintf(stderr, "[Fuzzilli] Global object structure created\n");

    fprintf(stderr, "[Fuzzilli] About to create global object\n");
    m_globalObject = JSC::JSGlobalObject::create(m_vm.get(), structure);
    if (!m_globalObject) {
        fprintf(stderr, "[Fuzzilli] ERROR: Failed to create global object\n");
        std::abort();
    }
    fprintf(stderr, "[Fuzzilli] Global object created successfully\n");
    fprintf(stderr, "[Fuzzilli] Reprl() constructor completed\n");
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
