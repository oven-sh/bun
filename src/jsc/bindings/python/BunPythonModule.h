#pragma once

// For the modules of Python's standard library that are written here rather than in JavaScriptCore, because they need a
// library that Bun has and JavaScriptCore does not. BunPythonModules.cpp lists them.

#include "root.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/PyAbstract.h>
#include <JavaScriptCore/PyBuffer.h>
#include <JavaScriptCore/PyBytes.h>
#include <JavaScriptCore/PyDict.h>
#include <JavaScriptCore/PyErrors.h>
#include <JavaScriptCore/PyInternals.h>
#include <JavaScriptCore/PyList.h>
#include <JavaScriptCore/PyModule.h>
#include <JavaScriptCore/PyModuleHelpers.h>
#include <JavaScriptCore/PyNative.h>
#include <JavaScriptCore/PyNumbers.h>
#include <JavaScriptCore/PyRuntime.h>
#include <JavaScriptCore/PyStr.h>
#include <JavaScriptCore/PyTuple.h>

namespace Bun {
namespace PythonModules {

using namespace JSC;
using namespace JSC::Python;

void initializeZlibModule(JSGlobalObject*, PyModule*);
void initializeBz2Module(JSGlobalObject*, PyModule*);
void initializeLzmaModule(JSGlobalObject*, PyModule*);
void initializeMD5Module(JSGlobalObject*, PyModule*);
void initializeSHA1Module(JSGlobalObject*, PyModule*);
void initializeSHA2Module(JSGlobalObject*, PyModule*);
void initializeSHA3Module(JSGlobalObject*, PyModule*);
void initializeBlake2Module(JSGlobalObject*, PyModule*);
void initializeHashlibModule(JSGlobalObject*, PyModule*);
void initializeHmacModule(JSGlobalObject*, PyModule*);
void initializeZstdModule(JSGlobalObject*, PyModule*);
void initializeSqlite3Module(JSGlobalObject*, PyModule*);
void initializeSslModule(JSGlobalObject*, PyModule*);
void initializeBunLoopModule(JSGlobalObject*, PyModule*);

// BunPythonEventLoop.cpp
void installPythonEventLoop();
// The exception that is propagating has nothing above it but the event loop: it is reported, and the process exits.
void exitWithUncaughtPythonException(JSGlobalObject*);
// BunPython.cpp. The status is what Python::handleUncaughtException() returns.
void exitWithPythonStatus(JSGlobalObject*, int status);

// ---- Objects that own what the collector knows nothing of ----
//
// The object is a PyRecord whose `number` is the address of a State, which is deleted when the record is collected: by the
// collector, on whichever of Python's threads it happens to sweep, so the destructor may neither touch the heap nor depend on
// the thread. A State that is part of the event loop, which belongs to the main thread, declares
// `static constexpr bool belongsToEventLoop = true`, and is deleted there.

// BunPythonEventLoop.cpp. Calls the function on the thread that turns the event loop of the VM, between two turns, unless this
// is that thread: then now. For whoever holds the GIL, the collector included.
void callOnEventLoopThread(VM&, Function<void()>&&);

template<typename State>
State* stateOf(PyRecord* record)
{
    return std::bit_cast<State*>(static_cast<uintptr_t>(record->number));
}

template<typename State>
State* stateOf(JSValue record)
{
    return stateOf<State>(uncheckedDowncast<PyRecord>(record.asCell()));
}

template<typename State>
void destroyStateOf(JSCell* cell)
{
    // The collector may be sweeping, when a cell cannot be asked what it is.
    auto* record = static_cast<PyRecord*>(cell);
    State* state = stateOf<State>(record);
    record->number = 0;
    if constexpr (requires { State::belongsToEventLoop; })
        callOnEventLoopThread(cell->vm(), [state] { delete state; });
    else
        delete state;
}

// `externalSize`: about how much memory the state holds on to, so that the collector knows what it gains by collecting it.
template<typename State>
PyRecord* createRecordWithState(JSGlobalObject* globalObject, PyType* type, unsigned fieldCount, std::unique_ptr<State>&& state, size_t externalSize = 0)
{
    VM& vm = getVM(globalObject);
    PyRecord* record = PyRecord::create(globalObject, type, fieldCount);
    record->number = static_cast<int64_t>(std::bit_cast<uintptr_t>(state.release()));
    vm.heap.addFinalizerForAnyThread(record, destroyStateOf<State>);
    if (externalSize)
        vm.heap.deprecatedReportExtraMemory(externalSize);
    return record;
}

// ---- Arguments, as the code Argument Clinic generates takes them ----

// For a function whose messages are those of _PyArg_UnpackKeywords(): in CPython, one that takes keywords, and any method that
// is told its defining class. (What NativeDef checks by itself words them as the other calling conventions do.)
struct Parameters {
    ASCIILiteral function;
    unsigned positionalOnly; // How many of the parameters cannot be given by name.
    unsigned required; // How many of those that can be given by position must be given.
    unsigned maxPositional;
    std::span<const ASCIILiteral> names; // Of the parameters after the positional-only ones.
    unsigned count() const { return positionalOnly + static_cast<unsigned>(names.size()); }
};

// values[i] is the argument for parameter i, or empty. False: a TypeError.
bool unpackArguments(JSGlobalObject*, const Parameters&, const CallArgs&, JSValue* values);
// "f() takes no arguments"
bool takesNoArguments(JSGlobalObject*, ASCIILiteral function, const CallArgs&);

// ---- Arguments, as Argument Clinic converts them ----

// int
inline bool intArgument(JSGlobalObject* globalObject, JSValue value, int defaultValue, int& result)
{
    if (!value) {
        result = defaultValue;
        return true;
    }
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    result = toCInt(globalObject, value);
    return !scope.exception();
}

// unsigned_int(bitwise=True): the low 32 bits of any int.
inline bool bitwiseUnsignedArgument(JSGlobalObject* globalObject, JSValue value, uint32_t defaultValue, uint32_t& result)
{
    if (!value) {
        result = defaultValue;
        return true;
    }
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue index = toIndex(globalObject, value);
    RETURN_IF_EXCEPTION(scope, false);
    JSValue masked = binaryOperation(globalObject, BinaryOperator::BitAnd, index, jsNumber(4294967295.0));
    RETURN_IF_EXCEPTION(scope, false);
    result = static_cast<uint32_t>(masked.asNumber());
    return true;
}

// unsigned_long, unsigned_long_long: both have 64 bits here, and they differ in what the message calls them.
inline bool unsignedArgument(JSGlobalObject* globalObject, JSValue value, ASCIILiteral cType, uint64_t defaultValue, uint64_t& result)
{
    if (!value) {
        result = defaultValue;
        return true;
    }
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue index = toIndex(globalObject, value);
    RETURN_IF_EXCEPTION(scope, false);
    if (intSign(index) < 0) {
        raiseValueError(globalObject, scope, "Cannot convert negative int"_s);
        return false;
    }
    auto converted = tryUInt64(index);
    if (!converted) {
        raiseOverflowError(globalObject, scope, "Python int too large for C "_s, cType);
        return false;
    }
    result = *converted;
    return true;
}

// Py_ssize_t(allow_negative=False)
inline bool nonNegativeSsizeArgument(JSGlobalObject* globalObject, JSValue value, ASCIILiteral name, int64_t defaultValue, int64_t& result)
{
    if (!value) {
        result = defaultValue;
        return true;
    }
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!ssizeArgument(globalObject, value, result))
        return false;
    if (result < 0) {
        raiseValueError(globalObject, scope, name, " cannot be negative"_s);
        return false;
    }
    return true;
}

// While a buffer is held, a bytearray cannot be resized, but the memory of a typed array of JS can be detached, or move. So this
// comes after the last thing that may have run code of the program (converting another argument, taking another buffer) and before
// the memory is used. False: a BufferError.
template<typename... Holders>
inline bool refreshBuffers(JSGlobalObject* globalObject, Holders&... holders)
{
    return (refreshBuffer(globalObject, holders.buffer) && ...);
}

inline JSValue bytesFrom(JSGlobalObject* globalObject, std::span<const uint8_t> span)
{
    if (span.empty())
        return runtime(globalObject).emptyBytes();
    PyBytes* bytes = newBytes(globalObject, span.size());
    if (!bytes)
        return { };
    memcpy(bytes->mutableData(), span.data(), span.size());
    return bytes;
}

// What a compressor or a decompressor writes to: memory that grows as it fills.
class OutputMemory {
public:
    // No more than `limit` bytes are ever made room for, if that is not negative.
    OutputMemory(size_t initialSize, size_t smallestStep, int64_t limit)
        : m_smallestStep(smallestStep)
        , m_limit(limit)
    {
        m_isValid = m_bytes.tryGrow(withinLimit(initialSize));
    }

    bool isValid() const { return m_isValid; }
    bool isAtLimit() const { return m_limit >= 0 && m_bytes.size() == static_cast<size_t>(m_limit); }

protected:
    std::span<uint8_t> memory() { return m_bytes.mutableSpan(); }
    // False: there is no memory for more.
    bool growMemory() { return m_bytes.tryGrow(withinLimit(m_bytes.size() + std::max(m_bytes.size(), m_smallestStep))); }
    JSValue bytesOfFirst(JSGlobalObject* globalObject, size_t count) { return bytesFrom(globalObject, m_bytes.span().first(count)); }

private:
    size_t withinLimit(size_t size) const { return m_limit >= 0 ? std::min(size, static_cast<size_t>(m_limit)) : size; }

    Vector<uint8_t> m_bytes;
    size_t m_smallestStep;
    int64_t m_limit;
    bool m_isValid;
};

} // namespace PythonModules
} // namespace Bun
