#pragma once

#include "root.h"
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSType.h>
#include <optional>
#include <span>

namespace Bun {

JSC::JSValue copyOfPythonMemory(JSC::JSGlobalObject*, JSC::JSValue);

// For code that takes a typed array and only reads it. An object of Python's that exports its memory (bytes, bytearray,
// memoryview, ...) is a buffer to it: what it gets in the object's place is a Uint8Array with a copy of the bytes, as
// `new Uint8Array(typedArray)` makes. Any other value as it is.
//
// Throws what Python raises if the memory cannot be had: of a view that was released, or whose bytes do not follow one another.
//
// Code that writes, or keeps the bytes, borrows the memory: JSC::Python::BufferHolder for the length of a call, and see
// JSC__JSValue__asArrayBuffer for longer.
ALWAYS_INLINE JSC::JSValue copyIfPythonMemory(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    if (!value || !value.isCell() || !JSC::isPyObjectType(value.asCell()->type())) [[likely]]
        return value;
    return copyOfPythonMemory(globalObject, value);
}

// The bytes of such an object where they are, for code that has done with them at once: before it allocates a cell, and before
// anything of the program runs. (What keeps them may be an object that only this function saw.) std::nullopt: it is no such
// object, or it threw, as above.
//
// An instance of a class whose __buffer__() is written in Python gives its bytes by running that. RunsNoCode is for a caller that
// has checked the state of something which such code could change (a hash that is not finalized, a statement that is open):
// to it that instance is no buffer.
enum class PythonMemoryAccess : bool { RunsNoCode, MayRunCode };
std::optional<std::span<const uint8_t>> bytesOfPythonMemory(JSC::JSGlobalObject*, JSC::JSValue, PythonMemoryAccess = PythonMemoryAccess::RunsNoCode);

}
