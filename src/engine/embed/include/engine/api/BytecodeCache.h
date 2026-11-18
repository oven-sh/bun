#pragma once

// Compiled code that is kept: in memory for the next run, and as bytes for the next process.

#include "engine/api/Code.h"

namespace JSC {

enum class SourceCodeType : bool { ProgramType,
    ModuleType };

// Calls `take` with the code of all functions, unless the text has an error or the code cannot be stored.
template<typename Take> void generateBytecode(VM& vm, const SourceCode& source, SourceCodeType type, Take&& take)
{
    Engine::bytecode_generate(vm, source, type == SourceCodeType::ModuleType, &take, [](void* take, const uint8_t* bytes, size_t size) { (*static_cast<Take*>(take))(std::span { bytes, size }); });
}
// Whether the bytes start like what this build generates from that text. Looks at no more than Engine::Layout::bytecodeKeySize.
inline bool isBytecodeOf(const SourceCode& source, SourceCodeType type, std::span<const uint8_t> bytes) { return Engine::bytecode_is_of(source, type == SourceCodeType::ModuleType, bytes); }
// Gives a built-in, whose text `sourceStamp` stands for, the code that the executable has for it. False if that is of no use.
inline bool loadBytecode(VM& vm, UnlinkedFunctionExecutable& function, unsigned sourceStamp, std::span<const uint8_t> bytes, uint32_t entry) { return Engine::bytecode_load_for_builtin(vm, function, sourceStamp, bytes, entry); }

// Has the address of the VM.
class CodeCache {
public:
    size_t workingSetMaxEntries() const { return Engine::code_cache_max_entries(vm()); }
    void setWorkingSetMaxEntries(size_t count) { Engine::code_cache_set_max_entries(vm(), count); }

private:
    const VM& vm() const { return Engine::fieldAt<VM>(this, 0); }
};

// A script that can run any number of times, in any realm of the VM.
class UnlinkedProgramCodeBlock {
    WTF_MAKE_NONCOPYABLE(UnlinkedProgramCodeBlock);

public:
    // For the global scope, unless there is another. Null if there is an error.
    static RefPtr<UnlinkedProgramCodeBlock> compile(JSGlobalObject* globalObject, const SourceCode& source, ParserError& error, JSScope* scope = nullptr) { return Engine::compiled_script_create(globalObject, source, error, scope); }

    void ref() const { Engine::compiled_script_retain(this); }
    void deref() const { Engine::compiled_script_release(this); }

    // Not if a debugger or a profiler has come or gone.
    bool isUsableIn(JSGlobalObject* globalObject) const { return Engine::compiled_script_is_usable_in(*this, globalObject); }
    // Without running the script. Null if it has no function.
    JSFunction* createFirstFunction(JSGlobalObject* globalObject, JSScope* scope) const { return Engine::compiled_script_create_first_function(*this, globalObject, scope); }
};

// Compiles the source if `code` is null.
JSValue evaluate(JSGlobalObject*, const SourceCode&, UnlinkedProgramCodeBlock* code, JSValue thisValue, NakedPtr<Exception>& returnedException);

} // namespace JSC
